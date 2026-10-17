package ro.horizontal.app.core

import org.junit.Assert.assertEquals
import org.junit.Assert.assertNull
import org.junit.Test
import java.time.ZoneId

class ShadeTest {
    private val zone = ZoneId.of("Europe/Bucharest")
    private val now = parseIso("2026-10-06T08:00:00.000Z")!!   // marți, 11:00
    private fun item(id: String, title: String, dueAt: String?, allDay: Boolean = true, urgent: Boolean = false, hiddenUntil: Long? = null,
                     pinnedAt: String? = null) =
        AgendaItem(id, title, null, dueAt, allDay, false, false, urgent, hiddenUntil, pinnedAt = pinnedAt)
    private fun state(vararg items: AgendaItem) = agendaState(null, AgendaList(items.toList(), 1), emptyList(), now, zone)

    @Test fun fărăListă_nuSeArată() {
        assertNull(shadeText(AgendaState.NoData, now, zone))
    }

    @Test fun nimicDeloc() {
        assertEquals(ShadeText(0, "Nimic pe azi", "Nici în următoarele 7 zile."), shadeText(state(), now, zone))
    }

    @Test fun numărulEAlWidgetului_restanțeleÎntâi() {
        val s = state(
            item("A", "Taxe", "2026-10-03T21:00:00.000Z"),                       // restanță de duminică
            item("B", "Ședință", "2026-10-06T12:00:00.000Z", allDay = false),     // azi 15:00
            item("C", "Mâine", "2026-10-06T21:00:00.000Z"),                       // mâine — nu se numără
        )
        assertEquals(ShadeText(2, "Taxe", "4 oct · încă 1"), shadeText(s, now, zone))
    }

    @Test fun oSingurăSarcină_cuOră_fărăÎncă() {
        val s = state(item("B", "Ședință", "2026-10-06T12:00:00.000Z", allDay = false))
        assertEquals(ShadeText(1, "Ședință", "Azi 15:00"), shadeText(s, now, zone))
    }

    @Test fun restanțaDeIeri() {
        assertEquals(ShadeText(1, "Taxe", "Ieri"), shadeText(state(item("A", "Taxe", "2026-10-04T21:00:00.000Z")), now, zone))
    }

    @Test fun ziLiberă_aratăCeUrmează() {
        val s = state(item("C", "Dentist", "2026-10-07T07:00:00.000Z", allDay = false))
        assertEquals(ShadeText(0, "Nimic pe azi", "Urmează: Dentist · Mâine 10:00"), shadeText(s, now, zone))
    }

    @Test fun rutinaAscunsă_nuSeNumără() {
        val s = state(
            item("R", "Pastile", "2026-10-06T17:00:00.000Z", allDay = false, hiddenUntil = parseIso("2026-10-06T17:00:00.000Z")),
            item("B", "Ședință", "2026-10-06T12:00:00.000Z", allDay = false),
        )
        assertEquals(ShadeText(1, "Ședință", "Azi 15:00"), shadeText(s, now, zone))
    }

    @Test fun urgentulÎntâi() {
        val s = state(
            item("A", "Taxe", "2026-10-06T13:00:00.000Z", allDay = false),
            item("U", "Server căzut", "2026-10-06T14:00:00.000Z", allDay = false, urgent = true),
        )
        assertEquals(ShadeText(2, "Server căzut", "Azi 17:00 · încă 1"), shadeText(s, now, zone))
    }

    @Test fun fixataSus_chiarFărăScadență_șiSeNumără() {
        val s = state(
            item("A", "Taxe", "2026-10-03T21:00:00.000Z"),                                     // restanță
            item("P", "Credențiale ANAF", null, pinnedAt = "2026-10-06T07:00:00.000Z"),
        )
        assertEquals(ShadeText(2, "Credențiale ANAF", "Fixată · încă 1"), shadeText(s, now, zone))
    }

    @Test fun fixataDeMâine_îșiSpuneZiua_șiȚineZiuaOcupată() {
        val s = state(item("P", "Dentist", "2026-10-07T07:00:00.000Z", allDay = false, pinnedAt = "2026-10-06T07:00:00.000Z"))
        assertEquals(ShadeText(1, "Dentist", "Fixată · Mâine 10:00"), shadeText(s, now, zone))
    }

    @Test fun ceaMaiRecentFixată_ePrima() {
        val s = state(
            item("P1", "Veche", null, pinnedAt = "2026-10-01T07:00:00.000Z"),
            item("P2", "Nouă", null, pinnedAt = "2026-10-05T07:00:00.000Z"),
        )
        assertEquals(ShadeText(2, "Nouă", "Fixată · încă 1"), shadeText(s, now, zone))
    }
}
