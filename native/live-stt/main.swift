// live-stt: live, word-by-word transcription for Interviewer Helper using Apple's on-device recognizer.
//
// stdin  : raw PCM16 little-endian, 16 kHz, mono (the same chunks the app already sends to Groq)
// stdout : JSON lines
//   {"type":"status","state":"asking|ready|denied|unavailable", ...}
//   {"type":"partial","seg":3,"text":"¿Cuál es tu"}
//   {"type":"final","seg":3,"text":"¿Cuál es tu experiencia?","reason":"cut|apple|age|error|eof"}
// SIGUSR1: close the current segment now (the app sends it when its own VAD ends an utterance).
// Locale : first argument or LIVE_STT_LOCALE: es-ES or en-US only, default es-ES.
//
// Apple caps one recognition task at about a minute, so a segment is closed on every
// cut / Apple final, and after ~50 s at the latest; the next task starts right away and
// the audio keeps flowing into it, so nothing is lost between tasks.

import Foundation
import Speech
import AVFoundation

setvbuf(stdout, nil, _IOLBF, 0)

func emit(_ obj: [String: Any]) {
    guard let data = try? JSONSerialization.data(withJSONObject: obj),
          let line = String(data: data, encoding: .utf8) else { return }
    print(line)
}

// ── Own TCC identity ──
// Spawned by Electron, macOS would charge the Speech Recognition permission to Electron.app,
// which has no NSSpeechRecognitionUsageDescription (= crash). Re-spawn ourselves with
// "responsibility disclaimed" so the permission belongs to this binary and its embedded Info.plist.
@_silgen_name("responsibility_spawnattrs_setdisclaim")
func responsibility_spawnattrs_setdisclaim(_ attrs: UnsafeMutablePointer<posix_spawnattr_t?>, _ disclaim: Int32) -> Int32

var childPid: pid_t = 0
if ProcessInfo.processInfo.environment["LIVE_STT_CHILD"] == nil {
    var attr: posix_spawnattr_t?
    posix_spawnattr_init(&attr)
    _ = responsibility_spawnattrs_setdisclaim(&attr, 1)
    let exe = Bundle.main.executablePath ?? CommandLine.arguments[0]
    let args: [UnsafeMutablePointer<CChar>?] = CommandLine.arguments.map { strdup($0) } + [nil]
    let envStrings: [String] = ProcessInfo.processInfo.environment.map { "\($0.key)=\($0.value)" } + ["LIVE_STT_CHILD=1"]
    let env: [UnsafeMutablePointer<CChar>?] = envStrings.map { strdup($0) } + [nil]
    guard posix_spawn(&childPid, exe, nil, &attr, args, env) == 0 else {
        emit(["type": "status", "state": "unavailable", "reason": "spawn failed"])
        exit(3)
    }
    // Pass stop / cut signals through to the child
    for sig in [SIGTERM, SIGINT, SIGHUP, SIGUSR1] {
        signal(sig) { s in kill(childPid, s); if s != SIGUSR1 { exit(0) } }
    }
    var status: Int32 = 0
    while waitpid(childPid, &status, 0) == -1 && errno == EINTR {}
    exit((status >> 8) & 0xff)
}

// ── Recognition ──
// Calls are only in Spanish or English: anything else falls back to Spanish.
let requestedLocale = CommandLine.arguments.dropFirst().first ?? ProcessInfo.processInfo.environment["LIVE_STT_LOCALE"] ?? "es-ES"
let localeId = ["es-ES", "en-US"].contains(requestedLocale) ? requestedLocale : "es-ES"
let debug = ProcessInfo.processInfo.environment["LIVE_STT_DEBUG"] == "1"
let q = DispatchQueue(label: "live-stt")
let format = AVAudioFormat(commonFormat: .pcmFormatFloat32, sampleRate: 16000, channels: 1, interleaved: false)!

var recognizer: SFSpeechRecognizer!
var request: SFSpeechAudioBufferRecognitionRequest?   // the task that receives new audio
var tasks: [Int: SFSpeechRecognitionTask] = [:]
var texts: [Int: String] = [:]
var reasons: [Int: String] = [:]
var finished = Set<Int>()
var seg = 0
var segStart = Date()
var lastChange = Date()
var running = false
var errorStreak = 0

func finish(_ s: Int, _ text: String = "") {
    guard !finished.contains(s) else { return }
    finished.insert(s)
    let t = (text.isEmpty ? texts[s] ?? "" : text).trimmingCharacters(in: .whitespacesAndNewlines)
    if !t.isEmpty { emit(["type": "final", "seg": s, "text": t, "reason": reasons[s] ?? "apple"]) }
    texts[s] = nil; tasks[s] = nil; reasons[s] = nil
}

// Close the current segment. Apple keeps working on the audio it already has, so the last
// words still arrive (as partials of that segment) and then its final; new audio goes to a new task.
func cut(_ reason: String) {
    let old = seg
    reasons[old] = reason
    request?.endAudio()
    startTask()
    q.asyncAfter(deadline: .now() + 3) { finish(old) }   // in case Apple never sends the final
}

func startTask() {
    seg += 1
    let mySeg = seg
    let req = SFSpeechAudioBufferRecognitionRequest()
    req.shouldReportPartialResults = true
    if recognizer.supportsOnDeviceRecognition { req.requiresOnDeviceRecognition = true }
    req.addsPunctuation = true
    req.taskHint = .dictation
    request = req
    segStart = Date()
    lastChange = Date()
    tasks[mySeg] = recognizer.recognitionTask(with: req) { result, error in
        q.async {
            if debug, let r = result {
                emit(["type": "debug", "seg": mySeg, "current": mySeg == seg, "final": r.isFinal,
                      "meta": r.speechRecognitionMetadata != nil, "text": r.bestTranscription.formattedString])
            }
            if finished.contains(mySeg) { return }
            if let r = result {
                if mySeg == seg { errorStreak = 0 }
                let text = r.bestTranscription.formattedString
                if r.isFinal { finish(mySeg, text); return }
                if !text.isEmpty && text != texts[mySeg] {
                    texts[mySeg] = text
                    if mySeg == seg { lastChange = Date() }
                    emit(["type": "partial", "seg": mySeg, "text": text])
                }
                // Apple heard the end of a sentence on its own (~2 s of silence)
                if r.speechRecognitionMetadata != nil && mySeg == seg { cut("apple") }
            } else if let error = error {
                // 1110 = no speech in this task; anything else is worth a line on stdout
                let code = (error as NSError).code
                if debug || code != 1110 { emit(["type": "debug", "seg": mySeg, "error": "\(code) \(error.localizedDescription)"]) }
                reasons[mySeg] = reasons[mySeg] ?? "error"
                finish(mySeg)
                if mySeg == seg {
                    errorStreak += 1
                    request = nil   // drop audio during the short back-off
                    q.asyncAfter(deadline: .now() + min(2.0, 0.2 * Double(errorStreak))) { if seg == mySeg { startTask() } }
                }
            }
        }
    }
}

// Rotate before Apple's ~1 minute cap: prefer a quiet moment after 40 s, force it at 52 s
func ageCheck() {
    q.asyncAfter(deadline: .now() + 1) {
        let age = Date().timeIntervalSince(segStart)
        let quiet = Date().timeIntervalSince(lastChange) > 1.2
        if running && request != nil && (age > 52 || (age > 40 && quiet)) { cut("age") }
        ageCheck()
    }
}

func begin() {
    guard let r = SFSpeechRecognizer(locale: Locale(identifier: localeId)), r.isAvailable else {
        emit(["type": "status", "state": "unavailable", "locale": localeId])
        exit(3)
    }
    recognizer = r
    emit(["type": "status", "state": "ready", "locale": localeId, "onDevice": r.supportsOnDeviceRecognition])
    running = true
    startTask()
    ageCheck()
}

// SIGUSR1 = the app's VAD saw the end of an utterance: close the segment now
signal(SIGUSR1, SIG_IGN)
let cutSource = DispatchSource.makeSignalSource(signal: SIGUSR1, queue: q)
// Apple runs ~0.5 s behind the audio and drops what it hasn't decoded when the audio ends,
// so the cut waits for it to catch up (the new audio meanwhile still goes to this segment).
var cutPending = false
cutSource.setEventHandler {
    guard running, request != nil, !cutPending else { return }
    cutPending = true
    let s = seg
    q.asyncAfter(deadline: .now() + 0.7) { cutPending = false; if seg == s { cut("cut") } }
}
cutSource.resume()

// stdin reader: audio is dropped until recognition is running (e.g. while macOS asks for permission)
Thread.detachNewThread {
    var carry = Data()
    let size = 8192
    let buf = UnsafeMutablePointer<UInt8>.allocate(capacity: size)
    while true {
        let n = read(0, buf, size)
        if n <= 0 { break }
        carry.append(buf, count: n)
        let samples = carry.count / 2
        if samples == 0 { continue }
        guard let pcm = AVAudioPCMBuffer(pcmFormat: format, frameCapacity: AVAudioFrameCount(samples)) else { continue }
        pcm.frameLength = AVAudioFrameCount(samples)
        let out = pcm.floatChannelData![0]
        carry.withUnsafeBytes { raw in
            let ints = raw.bindMemory(to: Int16.self)
            for i in 0..<samples { out[i] = Float(Int16(littleEndian: ints[i])) / 32768 }
        }
        carry.removeFirst(samples * 2)
        q.async { if running { request?.append(pcm) } }
    }
    // stdin closed (app quit or test file finished): close the last segment, give Apple a moment, exit
    q.async {
        if running { request?.endAudio() }
        reasons[seg] = "eof"
        q.asyncAfter(deadline: .now() + 1.5) {
            for s in tasks.keys.sorted() { finish(s) }
            exit(0)
        }
    }
}

switch SFSpeechRecognizer.authorizationStatus() {
case .authorized:
    q.async { begin() }
case .notDetermined:
    emit(["type": "status", "state": "asking"])
    SFSpeechRecognizer.requestAuthorization { status in
        q.async {
            if status == .authorized { begin() }
            else { emit(["type": "status", "state": "denied"]); exit(2) }
        }
    }
default:
    emit(["type": "status", "state": "denied"])
    exit(2)
}

dispatchMain()
