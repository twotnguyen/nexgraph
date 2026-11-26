from fastapi import APIRouter

from nexgraph_engine.indexing.docs.media import tools_available

router = APIRouter(prefix="/v1")


@router.get("/tools")
def tools() -> dict[str, bool]:
    """Công cụ ngoài có trên máy; thẻ chức năng thiếu công cụ hiện "Cần cài …" (spec F10 §4.5)."""
    return tools_available()
