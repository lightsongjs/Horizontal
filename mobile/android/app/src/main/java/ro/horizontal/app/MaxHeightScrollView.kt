package ro.horizontal.app

import android.content.Context
import android.util.AttributeSet
import android.widget.ScrollView

/**
 * Descrierea lungă derulează în ea în loc să împingă foaia (și atașamentele de
 * sub ea) afară de pe ecran. Plafonul e în `onMeasure`, deci ține și când textul
 * sosește după primul cadru.
 */
class MaxHeightScrollView(ctx: Context, attrs: AttributeSet?) : ScrollView(ctx, attrs) {
    override fun onMeasure(widthSpec: Int, heightSpec: Int) {
        val max = (resources.displayMetrics.heightPixels * 0.4).toInt()
        super.onMeasure(widthSpec, MeasureSpec.makeMeasureSpec(max, MeasureSpec.AT_MOST))
    }
}
