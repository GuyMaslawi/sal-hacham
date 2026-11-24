import AVFoundation
import Capacitor
import Speech

/// The app's main screen: Capacitor's web view, plus the plugins that live in this app.
class AppViewController: CAPBridgeViewController {
    override open func capacitorDidLoad() {
        bridge?.registerPluginInstance(DictationPlugin())
    }
}

/// Saying the shopping list out loud, with the phone's own speech recognizer (src/lib/speech.ts).
///
/// Every pause ends an item: when no new words arrive for a moment, what was said becomes a line
/// and a fresh recognition starts for the next one. The web page gets `text` events with the
/// finished items and the words still being said, and one `end` event when listening stops.
@objc(DictationPlugin)
public class DictationPlugin: CAPPlugin, CAPBridgedPlugin {
    public let identifier = "DictationPlugin"
    public let jsName = "Dictation"
    public let pluginMethods: [CAPPluginMethod] = [
        CAPPluginMethod(name: "available", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "start", returnType: CAPPluginReturnPromise),
        CAPPluginMethod(name: "stop", returnType: CAPPluginReturnPromise),
    ]

    /// How long a pause has to be to end an item.
    private let pauseSeconds = 0.9

    private let engine = AVAudioEngine()
    private var recognizer: SFSpeechRecognizer?
    private var task: SFSpeechRecognitionTask?
    private var running = false
    private var heard: [String] = []
    private var current = ""
    private var pauseTimer: Timer?

    // The microphone delivers sound on its own thread; the request it feeds changes on each item.
    private let requestLock = NSLock()
    private var _request: SFSpeechAudioBufferRecognitionRequest?
    private var request: SFSpeechAudioBufferRecognitionRequest? {
        get { requestLock.lock(); defer { requestLock.unlock() }; return _request }
        set { requestLock.lock(); _request = newValue; requestLock.unlock() }
    }

    @objc func available(_ call: CAPPluginCall) {
        let recognizer = SFSpeechRecognizer(locale: Locale(identifier: call.getString("language") ?? "he-IL"))
        call.resolve(["available": recognizer?.isAvailable ?? false])
    }

    @objc func start(_ call: CAPPluginCall) {
        let language = call.getString("language") ?? "he-IL"
        SFSpeechRecognizer.requestAuthorization { status in
            guard status == .authorized else {
                DispatchQueue.main.async { call.reject("Speech recognition not allowed", "denied") }
                return
            }
            Self.askForMicrophone { granted in
                DispatchQueue.main.async {
                    guard granted else {
                        call.reject("Microphone not allowed", "denied")
                        return
                    }
                    do {
                        try self.begin(language: language)
                        call.resolve()
                    } catch DictationProblem.unsupported {
                        call.reject("Speech recognition is not available for this language", "unsupported")
                    } catch {
                        self.finish(error: "failed")
                        call.reject("Could not start listening", "failed")
                    }
                }
            }
        }
    }

    @objc func stop(_ call: CAPPluginCall) {
        DispatchQueue.main.async {
            self.finish(error: nil)
            call.resolve()
        }
    }

    private enum DictationProblem: Error { case unsupported }

    private static func askForMicrophone(_ done: @escaping (Bool) -> Void) {
        if #available(iOS 17.0, *) {
            AVAudioApplication.requestRecordPermission(completionHandler: done)
        } else {
            AVAudioSession.sharedInstance().requestRecordPermission(done)
        }
    }

    private func begin(language: String) throws {
        if running { finish(error: nil) }
        guard let recognizer = SFSpeechRecognizer(locale: Locale(identifier: language)), recognizer.isAvailable else {
            throw DictationProblem.unsupported
        }
        self.recognizer = recognizer
        heard = []
        current = ""

        let session = AVAudioSession.sharedInstance()
        try session.setCategory(.record, mode: .measurement, options: .duckOthers)
        try session.setActive(true, options: .notifyOthersOnDeactivation)

        let input = engine.inputNode
        input.removeTap(onBus: 0)
        input.installTap(onBus: 0, bufferSize: 1024, format: input.outputFormat(forBus: 0)) { [weak self] buffer, _ in
            self?.request?.append(buffer)
        }
        engine.prepare()
        try engine.start()
        running = true
        startItem()
        send()
    }

    /// A new recognition for the next item.
    private func startItem() {
        guard running, let recognizer else { return }
        let request = SFSpeechAudioBufferRecognitionRequest()
        request.shouldReportPartialResults = true
        request.addsPunctuation = false
        // Keep the sound on the phone when it can recognize Hebrew by itself.
        if recognizer.supportsOnDeviceRecognition { request.requiresOnDeviceRecognition = true }
        self.request = request
        task = recognizer.recognitionTask(with: request) { [weak self] result, error in
            DispatchQueue.main.async { self?.handle(result: result, error: error, from: request) }
        }
    }

    private func handle(result: SFSpeechRecognitionResult?, error: Error?, from request: SFSpeechAudioBufferRecognitionRequest) {
        // Results of an item that already ended are ignored.
        guard running, request === self.request else { return }
        if let result {
            current = result.bestTranscription.formattedString
            send()
            pauseTimer?.invalidate()
            pauseTimer = Timer.scheduledTimer(withTimeInterval: pauseSeconds, repeats: false) { [weak self] _ in
                self?.nextItem()
            }
            if result.isFinal { nextItem() }
        } else if error != nil {
            // Silence ends a recognition with an error; carry on listening for the next item.
            nextItem()
        }
    }

    /// The speaker paused: what they said is one item, and listening goes on for the next.
    private func nextItem() {
        pauseTimer?.invalidate()
        let said = current.trimmingCharacters(in: .whitespacesAndNewlines)
        if !said.isEmpty { heard.append(said) }
        current = ""
        let old = task
        request?.endAudio()
        old?.cancel()
        startItem()
        send()
    }

    private func send() {
        notifyListeners("text", data: ["heard": heard, "current": current])
    }

    private func finish(error: String?) {
        guard running else { return }
        running = false
        pauseTimer?.invalidate()
        let said = current.trimmingCharacters(in: .whitespacesAndNewlines)
        if !said.isEmpty { heard.append(said) }
        current = ""
        engine.stop()
        engine.inputNode.removeTap(onBus: 0)
        request?.endAudio()
        task?.cancel()
        request = nil
        task = nil
        try? AVAudioSession.sharedInstance().setActive(false, options: .notifyOthersOnDeactivation)
        send()
        var data: [String: Any] = [:]
        if let error { data["error"] = error }
        notifyListeners("end", data: data)
    }
}
