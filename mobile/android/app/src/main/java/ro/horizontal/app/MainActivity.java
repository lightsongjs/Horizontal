package ro.horizontal.app;

import android.os.Bundle;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Pluginul local se înregistrează ÎNAINTE de super: bridge-ul se
        // construiește acolo și nu mai vede plugine adăugate după.
        registerPlugin(HorizontalAndroidPlugin.class);
        super.onCreate(savedInstanceState);
    }
}
