import json
from collections import defaultdict

from fastapi import WebSocket


class ConnectionManager:
    """Tracks websocket connections per consultation session and broadcasts
    JSON messages to every participant (doctor + patient) in that session."""

    def __init__(self) -> None:
        self._connections: dict[str, set[WebSocket]] = defaultdict(set)

    async def connect(self, session_id: str, websocket: WebSocket) -> None:
        await websocket.accept()
        self._connections[session_id].add(websocket)

    def disconnect(self, session_id: str, websocket: WebSocket) -> None:
        self._connections[session_id].discard(websocket)
        if not self._connections[session_id]:
            self._connections.pop(session_id, None)

    async def broadcast(self, session_id: str, message: dict) -> None:
        payload = json.dumps(message, default=str)
        dead: list[WebSocket] = []
        for ws in self._connections.get(session_id, set()):
            try:
                await ws.send_text(payload)
            except Exception:
                dead.append(ws)
        for ws in dead:
            self.disconnect(session_id, ws)


manager = ConnectionManager()
