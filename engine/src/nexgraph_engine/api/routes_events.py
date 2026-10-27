import asyncio
import json

from fastapi import APIRouter, Request
from fastapi.responses import StreamingResponse

router = APIRouter(prefix="/v1")


@router.get("/events")
async def events(request: Request) -> StreamingResponse:
    services = request.app.state.services
    ping = request.app.state.sse_ping_seconds
    sub = services.bus.subscribe()

    async def stream():
        try:
            while not await request.is_disconnected():
                event = await asyncio.to_thread(sub.get, ping)
                yield ": ping\n\n" if event is None else f"data: {json.dumps(event, ensure_ascii=False)}\n\n"
        finally:
            sub.close()

    return StreamingResponse(stream(), media_type="text/event-stream", headers={"Cache-Control": "no-cache"})
