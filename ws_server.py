import asyncio
import json
import websockets
from predict import predict_engine_decision

connected_clients = set()

async def telemetry_listener():
    uri = "ws://localhost:8080/telemetry"
    while True:
        try:
            async with websockets.connect(uri) as ws:
                print("[AI Engine] Connected to Virtual Engine telemetry stream on port 8080.")
                async for message in ws:
                    packet = json.loads(message)
                    decision = predict_engine_decision(packet)

                    if connected_clients and decision:
                        payload = json.dumps(decision)
                        await asyncio.gather(*[client.send(payload) for client in connected_clients])
        except Exception:
            await asyncio.sleep(2)

async def decision_server(websocket):
    connected_clients.add(websocket)
    print("[AI Engine] Dashboard client connected to /decision")
    try:
        await websocket.wait_closed()
    finally:
        connected_clients.remove(websocket)

async def main():
    server = await websockets.serve(decision_server, "0.0.0.0", 8081)
    print("AI/Math Decision WebSocket active on ws://0.0.0.0:8081/decision")
    await asyncio.gather(server.wait_closed(), telemetry_listener())

if __name__ == "__main__":
    asyncio.run(main())