package app.pennywise.sms

import android.view.View
import android.view.ViewGroup
import android.view.WindowManager
import android.widget.Switch
import androidx.test.core.app.ActivityScenario
import androidx.test.core.app.ApplicationProvider
import androidx.test.ext.junit.runners.AndroidJUnit4
import org.junit.Assert.*
import org.junit.Assume.assumeTrue
import org.junit.Test
import org.junit.runner.RunWith

@RunWith(AndroidJUnit4::class)
class SmsSettingsTest {
    @Test fun nativeSettingsStartsOffAndProtectsTokenScreen() {
        val context = ApplicationProvider.getApplicationContext<android.content.Context>()
        assumeTrue(SmsPreferences(context).snapshot().token.isEmpty())
        ActivityScenario.launch(SmsSettingsActivity::class.java).use { scenario ->
            scenario.onActivity { activity ->
                assertTrue(activity.window.attributes.flags and WindowManager.LayoutParams.FLAG_SECURE != 0)
                fun findSwitch(view: View): Switch? {
                    if (view is Switch) return view
                    if (view is ViewGroup) for (i in 0 until view.childCount) {
                        findSwitch(view.getChildAt(i))?.let { return it }
                    }
                    return null
                }
                val toggle = findSwitch(activity.window.decorView)!!
                assertFalse(toggle.isChecked)
                assertFalse(toggle.isEnabled) // A verified device token is required before opt-in.
            }
        }
    }
}
