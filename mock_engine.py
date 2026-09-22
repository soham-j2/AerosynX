import asyncio
import json
import time
import websockets

async def feed_telemetry(websocket):
    print("\n[Mock Virtual Engine] AI Decision Engine connected to telemetry stream.")
    while True:
        packet = {
            "timestamp": int(time.time() * 1000),
            "reading": {
                "rpm": 5120,
                "cht_c": 112.4,
                "egt_c": 665.0,
                "oil_press_bar": 3.4,
                "oil_temp_c": 91.5,
                "fuel_flow_lph": 15.8,
                "vibration_g": 0.09,
                "battery_v": 14.1,
                "injection_deg": 22.5
            },
            "source": {
                "rpm": "HW",
                "vibration_g": "HW",
                "cht_c": "HW"
            },
            "context": {
                "active_fault": "none",
                "mission_profile": "normal_cruise"
            }
        }
        await websocket.send(json.dumps(packet))
        await asyncio.sleep(0.2)

async def main():
    async with websockets.serve(feed_telemetry, "0.0.0.0", 8080):
        print("[Mock Virtual Engine] Publishing telemetry on ws://localhost:8080/telemetry")
        await asyncio.Future()

if __name__ == "__main__":
    asyncio.run(main())