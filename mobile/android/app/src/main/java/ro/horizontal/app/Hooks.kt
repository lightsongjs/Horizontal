package ro.horizontal.app

import android.content.Context

/**
 * Ce pornește după o alarmă / repornire / acțiune. Task 9–10 le umplu
 * (worker-ele), din `HorizontalApp.onCreate` — receiverele nu se rescriu.
 */
object Hooks {
    var afterAlarm: (Context) -> Unit = {}
    var afterBoot: (Context) -> Unit = {}
    var afterQueued: (Context) -> Unit = {}
}
