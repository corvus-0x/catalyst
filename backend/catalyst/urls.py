import os

from django.conf import settings
from django.conf.urls.static import static
from django.contrib import admin
from django.http import HttpResponse, JsonResponse
from django.urls import include, path, re_path


def health_check(request):
    """Simple health check for Railway deployment monitoring."""
    return JsonResponse({"status": "ok"})


# ---------------------------------------------------------------------------
# SPA Serving: In production, serve the React app for all non-API routes.
# Check at request time (not import time) so collectstatic has already run.
# ---------------------------------------------------------------------------
_SPA_CANDIDATES = [
    os.path.join(str(settings.STATIC_ROOT), "frontend", "index.html"),
    os.path.join(settings.BASE_DIR, "static", "frontend", "index.html"),
]


def spa_view(request):
    """Serve the React SPA index.html for client-side routing."""
    for candidate in _SPA_CANDIDATES:
        if os.path.exists(candidate):
            with open(candidate) as f:
                return HttpResponse(f.read(), content_type="text/html")
    return JsonResponse(
        {"error": "Frontend not built", "searched": _SPA_CANDIDATES},
        status=404,
    )


# API and admin routes (always present)
urlpatterns = [
    path("admin/", admin.site.urls),
    path("api/health/", health_check, name="health_check"),
    path("", include("investigations.urls")),
] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)

# In production: add SPA catch-all for all non-API, non-static routes.
# The spa_view checks for index.html at request time so it always works.
if not settings.DEBUG:
    urlpatterns = [
        path("admin/", admin.site.urls),
        path("api/health/", health_check, name="health_check"),
        path("", include("investigations.urls")),
        re_path(r"^(?!api/|admin/|static/|media/).*$", spa_view),
    ] + static(settings.MEDIA_URL, document_root=settings.MEDIA_ROOT)
    urlpatterns.insert(0, path("", spa_view, name="spa_root"))
