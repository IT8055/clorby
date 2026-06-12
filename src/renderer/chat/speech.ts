// Local speech to text with transformers.js Whisper. Everything runs on this
// machine. The model downloads once on first use and is cached afterwards.
const MODEL = 'Xenova/whisper-tiny.en'
const SAMPLE_RATE = 16000
const MIN_SAMPLES = 1600 // ignore clips shorter than about 0.1 seconds
const SILENCE_PEAK = 0.01 // below this the clip is treated as silence
const NORMALISE_TARGET = 0.9 // boost quiet speech up to this peak amplitude

type Asr = (audio: Float32Array) => Promise<{ text?: string }>

let asrPromise: Promise<Asr> | null = null
let ready = false

async function getAsr(): Promise<Asr> {
  if (!asrPromise) {
    asrPromise = (async () => {
      const { pipeline } = await import('@huggingface/transformers')
      // fp32 avoids the 4-bit quantised weights, which fail to load on the
      // bundled onnxruntime-web build.
      const pipe = await pipeline('automatic-speech-recognition', MODEL, { dtype: 'fp32' })
      ready = true
      return pipe as unknown as Asr
    })()
  }
  return asrPromise
}

export function modelReady(): boolean {
  return ready
}

// Available microphones. Labels are only populated once the page has been
// granted microphone access at least once, so call this after a first capture.
export async function listMicrophones(): Promise<{ id: string; label: string }[]> {
  const devices = await navigator.mediaDevices.enumerateDevices()
  return devices
    .filter((device) => device.kind === 'audioinput')
    .map((device, index) => ({ id: device.deviceId, label: device.label || `Microphone ${index + 1}` }))
}

// Decode the recorded clip and resample it to mono 16 kHz, which is what
// Whisper expects.
async function blobToMono16k(blob: Blob): Promise<Float32Array> {
  const arrayBuffer = await blob.arrayBuffer()
  const ctx = new AudioContext()
  let decoded: AudioBuffer
  try {
    decoded = await ctx.decodeAudioData(arrayBuffer)
  } finally {
    await ctx.close()
  }
  const frames = Math.max(1, Math.ceil(decoded.duration * SAMPLE_RATE))
  const offline = new OfflineAudioContext(1, frames, SAMPLE_RATE)
  const source = offline.createBufferSource()
  source.buffer = decoded
  source.connect(offline.destination)
  source.start()
  const rendered = await offline.startRendering()
  return rendered.getChannelData(0)
}

// Push to talk: start() opens the microphone, stopAndTranscribe() returns the
// recognised text.
export class VoiceRecorder {
  private recorder: MediaRecorder | null = null
  private stream: MediaStream | null = null
  private chunks: Blob[] = []
  private meterCtx: AudioContext | null = null
  private meterRaf: number | null = null

  get active(): boolean {
    return this.recorder !== null
  }

  // onLevel, if given, is called each frame with the live peak amplitude (0..1)
  // so the UI can show whether the microphone is actually producing sound.
  // The label of the microphone the current capture is actually using.
  activeMicLabel = ''

  async start(onLevel?: (level: number) => void, deviceId?: string): Promise<void> {
    const audio: MediaTrackConstraints = {
      channelCount: 1,
      echoCancellation: true,
      noiseSuppression: true,
      // Let the browser boost a quiet microphone before we ever see the audio.
      autoGainControl: true
    }
    if (deviceId) audio.deviceId = { exact: deviceId }
    this.stream = await navigator.mediaDevices.getUserMedia({ audio })
    this.activeMicLabel = this.stream.getAudioTracks()[0]?.label ?? ''
    this.chunks = []
    this.recorder = new MediaRecorder(this.stream)
    this.recorder.ondataavailable = (event) => {
      if (event.data.size > 0) this.chunks.push(event.data)
    }
    // A timeslice makes the recorder flush data periodically rather than only at
    // stop, which is more robust across codecs.
    this.recorder.start(200)
    if (onLevel) this.startMeter(onLevel)
  }

  private startMeter(onLevel: (level: number) => void): void {
    if (!this.stream) return
    this.meterCtx = new AudioContext()
    void this.meterCtx.resume()
    const source = this.meterCtx.createMediaStreamSource(this.stream)
    const analyser = this.meterCtx.createAnalyser()
    analyser.fftSize = 1024
    source.connect(analyser)
    const buffer = new Float32Array(analyser.fftSize)
    const tick = (): void => {
      analyser.getFloatTimeDomainData(buffer)
      let peak = 0
      for (let i = 0; i < buffer.length; i++) {
        const sample = Math.abs(buffer[i])
        if (sample > peak) peak = sample
      }
      onLevel(peak)
      this.meterRaf = requestAnimationFrame(tick)
    }
    this.meterRaf = requestAnimationFrame(tick)
  }

  private stopMeter(): void {
    if (this.meterRaf !== null) {
      cancelAnimationFrame(this.meterRaf)
      this.meterRaf = null
    }
    if (this.meterCtx) {
      void this.meterCtx.close()
      this.meterCtx = null
    }
  }

  // level is the peak amplitude of the captured clip (0..1). A near-zero level
  // means the microphone produced silence, which is reported so the caller can
  // tell the user rather than inserting a Whisper hallucination.
  async stopAndTranscribe(): Promise<{ text: string; level: number }> {
    const recorder = this.recorder
    if (!recorder) return { text: '', level: 0 }
    const mimeType = recorder.mimeType
    const blob = await new Promise<Blob>((resolve) => {
      recorder.onstop = () => resolve(new Blob(this.chunks, { type: mimeType }))
      recorder.stop()
    })
    this.release()

    const audio = await blobToMono16k(blob)
    let peak = 0
    for (let i = 0; i < audio.length; i++) {
      const sample = Math.abs(audio[i])
      if (sample > peak) peak = sample
    }
    if (audio.length < MIN_SAMPLES || peak < SILENCE_PEAK) {
      return { text: '', level: peak }
    }

    // Normalise quiet speech up to a healthy level so Whisper hears it clearly.
    if (peak < NORMALISE_TARGET) {
      const gain = NORMALISE_TARGET / peak
      for (let i = 0; i < audio.length; i++) {
        audio[i] = Math.max(-1, Math.min(1, audio[i] * gain))
      }
    }

    const asr = await getAsr()
    const result = await asr(audio)
    return { text: (result.text ?? '').trim(), level: peak }
  }

  cancel(): void {
    if (this.recorder && this.recorder.state !== 'inactive') this.recorder.stop()
    this.release()
  }

  private release(): void {
    this.stopMeter()
    this.stream?.getTracks().forEach((track) => track.stop())
    this.stream = null
    this.recorder = null
    this.chunks = []
  }
}
