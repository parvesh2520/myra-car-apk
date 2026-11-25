package expo.modules.myrasystem

import android.app.ActivityManager
import android.content.Context
import android.content.pm.ApplicationInfo
import expo.modules.kotlin.modules.Module
import expo.modules.kotlin.modules.ModuleDefinition

/**
 * Frees RAM for the on-device model on low-end head units: asks Android to end other apps' background
 * processes (ActivityManager.killBackgroundProcesses, KILL_BACKGROUND_PROCESSES permission). Foreground apps,
 * persistent system processes and services Android protects are left alone; this is what "clear memory" does.
 */
class MyraSystemModule : Module() {
  private val context: Context
    get() = appContext.reactContext ?: throw IllegalStateException("no React context")

  private fun availMb(am: ActivityManager): Long {
    val info = ActivityManager.MemoryInfo()
    am.getMemoryInfo(info)
    return info.availMem / (1024 * 1024)
  }

  override fun definition() = ModuleDefinition {
    Name("MyraSystem")

    /** Free RAM in MB, as Android reports it. */
    Function("availableMemoryMb") {
      availMb(context.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager)
    }

    /** Ends other apps' background processes; returns {beforeMb, afterMb, apps}. */
    AsyncFunction("freeMemory") {
      val ctx = context
      val am = ctx.getSystemService(Context.ACTIVITY_SERVICE) as ActivityManager
      val before = availMb(am)
      var apps = 0
      for (app in ctx.packageManager.getInstalledApplications(0)) {
        if (app.packageName == ctx.packageName || (app.flags and ApplicationInfo.FLAG_PERSISTENT) != 0) continue
        am.killBackgroundProcesses(app.packageName)
        apps++
      }
      System.gc()
      mapOf("beforeMb" to before, "afterMb" to availMb(am), "apps" to apps)
    }
  }
}
