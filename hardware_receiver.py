import json
import serial


class HardwareReceiver:

    def __init__(
        self,
        port="COM5",
        baudrate=115200
    ):

        self.serial = serial.Serial(

            port,

            baudrate,

            timeout=1
        )

    def read(self):

        line = (

            self.serial
            .readline()
            .decode(
                "utf-8",
                errors="ignore"
            )
            .strip()
        )

        if not line:

            return None

        try:

            return json.loads(
                line
            )

        except json.JSONDecodeError:

            print(
                "Invalid ESP32 data:",
                line
            )

            return None

    def close(self):

        if self.serial.is_open:

            self.serial.close()


if __name__ == "__main__":

    receiver = HardwareReceiver(
        "COM5",
        115200
    )

    try:

        while True:

            data = receiver.read()

            if data:

                print(
                    "Hardware data:",
                    data
                )

    finally:

        receiver.close()