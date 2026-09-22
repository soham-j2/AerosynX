import math


class AeroPistonPhysics:

    def __init__(self):

        self.R = 287.05
        self.g = 9.80665
        self.sea_level_pressure = 101325
        self.sea_level_temperature = 288.15


    # --------------------------------------------
    # AIR DENSITY
    # --------------------------------------------

    def air_density(self, altitude, ambient_temp):

        temperature_kelvin = ambient_temp + 273.15

        pressure = (
            self.sea_level_pressure *
            math.exp(
                -altitude / 8500
            )
        )

        density = pressure / (
            self.R * temperature_kelvin
        )

        return density


    # --------------------------------------------
    # EXPECTED CHT
    # --------------------------------------------

    def expected_cht(
        self,
        rpm,
        load,
        altitude,
        ambient_temp,
        airspeed=35
    ):

        density = self.air_density(
            altitude,
            ambient_temp
        )

        cooling_effect = (
            0.015 *
            density *
            airspeed *
            100
        )

        heat_generation = (
            0.40 * load
            + 0.004 * (rpm - 2000)
        )

        cht = (
            ambient_temp
            + 80
            + heat_generation
            - cooling_effect
        )

        return max(
            ambient_temp + 30,
            cht
        )


    # --------------------------------------------
    # EXPECTED EGT
    # --------------------------------------------

    def expected_egt(
        self,
        rpm,
        load,
        altitude,
        ambient_temp
    ):

        density = self.air_density(
            altitude,
            ambient_temp
        )

        egt = (
            500
            + 1.5 * load
            + 0.025 * (rpm - 2000)
            + 25 * density / 1.225
            + 0.5 * (ambient_temp - 20)
        )

        return egt


    # --------------------------------------------
    # EXPECTED OIL PRESSURE
    # --------------------------------------------

    def expected_oil_pressure(
        self,
        rpm,
        load,
        oil_temp=80
    ):

        pressure = (
            20
            + 0.012 * rpm
            - 0.04 * load
            - 0.03 * max(oil_temp - 80, 0)
        )

        return max(10, pressure)


    # --------------------------------------------
    # EXPECTED OIL TEMPERATURE
    # --------------------------------------------

    def expected_oil_temp(
        self,
        load,
        ambient_temp
    ):

        return (
            50
            + 0.35 * load
            + 0.2 * ambient_temp
        )


    # --------------------------------------------
    # EXPECTED VIBRATION
    # --------------------------------------------

    def expected_vibration(
        self,
        rpm,
        load
    ):

        rpm_effect = abs(rpm - 2800) / 10000

        return (
            0.2
            + 0.002 * load
            + rpm_effect
        )


    # --------------------------------------------
    # FUEL FLOW
    # --------------------------------------------

    def expected_fuel_flow(
        self,
        rpm,
        load
    ):

        # Simplified BSFC-based approximation
        # Fuel flow = Power × BSFC

        estimated_power_kw = (
            0.02 * rpm * load / 100
        )

        bsfc = 0.30

        fuel_flow = (
            estimated_power_kw *
            bsfc
        )

        return max(
            0.5,
            fuel_flow
        )


    # --------------------------------------------
    # COMPLETE ENGINE STATE
    # --------------------------------------------

    def expected_state(
        self,
        rpm,
        load,
        altitude,
        ambient_temp,
        oil_temp=80,
        airspeed=35
    ):

        return {

            "cht": self.expected_cht(
                rpm,
                load,
                altitude,
                ambient_temp,
                airspeed
            ),

            "egt": self.expected_egt(
                rpm,
                load,
                altitude,
                ambient_temp
            ),

            "oil_pressure":
                self.expected_oil_pressure(
                    rpm,
                    load,
                    oil_temp
                ),

            "oil_temp":
                self.expected_oil_temp(
                    load,
                    ambient_temp
                ),

            "vibration":
                self.expected_vibration(
                    rpm,
                    load
                ),

            "fuel_flow":
                self.expected_fuel_flow(
                    rpm,
                    load
                )
        }