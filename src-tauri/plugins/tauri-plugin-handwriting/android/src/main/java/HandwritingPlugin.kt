package com.github.wintersteve25.myelin.handwriting

import android.app.Activity
import app.tauri.annotation.Command
import app.tauri.annotation.InvokeArg
import app.tauri.annotation.TauriPlugin
import app.tauri.plugin.Invoke
import app.tauri.plugin.Plugin
import com.google.android.gms.tasks.Tasks
import com.google.mlkit.common.MlKitException
import com.google.mlkit.common.model.DownloadConditions
import com.google.mlkit.common.model.RemoteModelManager
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognition
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognitionModel
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognitionModelIdentifier
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognizer
import com.google.mlkit.vision.digitalink.recognition.DigitalInkRecognizerOptions
import com.google.mlkit.vision.digitalink.recognition.Ink
import java.util.Locale
import java.util.concurrent.Executors

@InvokeArg
class RecognizeArgs {
  /** Lines of text; each line's strokes are flat `[x, y, x, y, ...]` lists. */
  lateinit var lines: Array<Array<FloatArray>>
}

@TauriPlugin
class HandwritingPlugin(private val activity: Activity) : Plugin(activity) {
  // Tasks.await must not run on the main thread, and one thread keeps the first model download
  // from racing a second Find.
  private val worker = Executors.newSingleThreadExecutor()
  private var recognizer: DigitalInkRecognizer? = null

  /** Resolves one string per line, in order. */
  @Command
  fun recognize(invoke: Invoke) {
    val args = invoke.parseArgs(RecognizeArgs::class.java)
    worker.execute {
      try {
        val client = recognizer ?: createRecognizer().also { recognizer = it }
        invoke.resolveObject(args.lines.map { line -> recognizeLine(client, line) })
      } catch (e: Exception) {
        invoke.reject(e.message ?: "Handwriting recognition failed.", e)
      }
    }
  }

  // The first call downloads the ~20MB model for the device language from Google. On a OnePlus 7T,
  // isModelDownloaded took 36.7s on first use after install (ML Kit registering its 725 language
  // packs) and 1.4s on later launches; recognizing a line takes 10-70ms.
  private fun createRecognizer(): DigitalInkRecognizer {
    val locale = Locale.getDefault()
    val identifier = modelFor(locale.toLanguageTag())
      ?: modelFor(locale.language)
      ?: modelFor("en-US")!!
    val model = DigitalInkRecognitionModel.builder(identifier).build()
    val models = RemoteModelManager.getInstance()
    if (!Tasks.await(models.isModelDownloaded(model))) {
      Tasks.await(models.download(model, DownloadConditions.Builder().build()))
    }
    return DigitalInkRecognition.getClient(DigitalInkRecognizerOptions.builder(model).build())
  }

  // `null` when ML Kit has no model for the tag; malformed tags throw.
  private fun modelFor(tag: String): DigitalInkRecognitionModelIdentifier? =
    try {
      DigitalInkRecognitionModelIdentifier.fromLanguageTag(tag)
    } catch (e: MlKitException) {
      null
    }

  private fun recognizeLine(client: DigitalInkRecognizer, line: Array<FloatArray>): String {
    val ink = Ink.builder()
    for (points in line) {
      val stroke = Ink.Stroke.builder()
      for (i in 0 until points.size / 2) {
        stroke.addPoint(Ink.Point.create(points[2 * i], points[2 * i + 1]))
      }
      ink.addStroke(stroke.build())
    }
    return Tasks.await(client.recognize(ink.build())).candidates.firstOrNull()?.text ?: ""
  }
}
