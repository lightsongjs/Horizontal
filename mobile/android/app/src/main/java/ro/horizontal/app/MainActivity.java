package ro.horizontal.app;

import android.os.Bundle;
import android.webkit.WebView;
import androidx.activity.OnBackPressedCallback;
import com.getcapacitor.BridgeActivity;

public class MainActivity extends BridgeActivity {
    @Override
    public void onCreate(Bundle savedInstanceState) {
        // Pluginul local se înregistrează ÎNAINTE de super: bridge-ul se
        // construiește acolo și nu mai vede plugine adăugate după.
        registerPlugin(HorizontalAndroidPlugin.class);
        super.onCreate(savedInstanceState);

        // Back-ul Android merge în istoricul paginii, ca în Chrome. Fără asta
        // (n-avem `@capacitor/app`), BridgeActivity lasă comportamentul
        // implicit — închide activitatea — deci Back ieșea din aplicație de
        // pe orice ecran, chiar și cu o foaie deschisă. Pagina își clădește
        // singură stiva (`goTop` din App.tsx: „Azi" e rădăcina), deci aici
        // doar o urmăm; când nu mai e nimic în spate, iese ca de obicei.
        getOnBackPressedDispatcher().addCallback(this, new OnBackPressedCallback(true) {
            @Override
            public void handleOnBackPressed() {
                WebView web = getBridge() != null ? getBridge().getWebView() : null;
                if (web != null && web.canGoBack()) {
                    web.goBack();
                    return;
                }
                setEnabled(false);
                getOnBackPressedDispatcher().onBackPressed();
                setEnabled(true);
            }
        });
    }
}
