package shop.mygreed.drillup

import android.net.Uri

enum class NavigationDestination {
    INTERNAL,
    EXTERNAL,
    BLOCKED,
}

object NavigationPolicy {
    private const val INTERNAL_HOST = "drillup.mygreed.shop"

    fun classify(uri: Uri): NavigationDestination {
        return when (uri.scheme?.lowercase()) {
            "mailto", "tel" -> NavigationDestination.EXTERNAL
            "https" -> classifyHttps(uri)
            else -> NavigationDestination.BLOCKED
        }
    }

    private fun classifyHttps(uri: Uri): NavigationDestination {
        if (uri.userInfo != null || uri.host.isNullOrBlank()) {
            return NavigationDestination.BLOCKED
        }
        if (uri.port != -1 && uri.port != 443) {
            return NavigationDestination.BLOCKED
        }

        val host = uri.host.orEmpty()
        return if (host.equals(INTERNAL_HOST, ignoreCase = true)) {
            NavigationDestination.INTERNAL
        } else if (
            host.endsWith(".$INTERNAL_HOST", ignoreCase = true) ||
            host.startsWith("$INTERNAL_HOST.", ignoreCase = true)
        ) {
            NavigationDestination.BLOCKED
        } else {
            NavigationDestination.EXTERNAL
        }
    }
}
