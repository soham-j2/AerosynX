import { useCallback, useEffect, useRef, useState } from "react";

const DEFAULT_WS_URL =
  import.meta.env.VITE_WS_URL ||
  "ws://localhost:8080/telemetry";

const EMPTY_PACKET = {
  timestamp: null,

  reading: {},

  source: {},

  range_status: {},

  possible_faults: [],

  context: {
    active_fault: "none",
    mission_profile: "normal_cruise",
  },

  twin: {
    current_state: {},
    expected_state: {},
    residuals: {},
    health_score: 0,
    physics: {},
    flight_hours: 0,
  },

  ai: {
    anomaly_status: "WAITING",
    anomaly_score: 0,
    predicted_fault: "healthy",
    fault_confidence: "0%",
    rul_hours: null,
    decision: "WAITING",
    maintenance_recommendation:
      "Waiting for telemetry...",
  },
};

export function useTelemetrySocket(url = DEFAULT_WS_URL) {
  const socketRef = useRef(null);

  const reconnectTimerRef = useRef(null);

  const manuallyClosedRef = useRef(false);

  const [packet, setPacket] =
    useState(EMPTY_PACKET);

  const [connected, setConnected] =
    useState(false);

  const [stale, setStale] =
    useState(true);

  /*
   * ----------------------------------------------------------
   * CONNECT
   * ----------------------------------------------------------
   */

  const connect = useCallback(() => {
    if (
      socketRef.current &&
      (
        socketRef.current.readyState ===
          WebSocket.OPEN ||
        socketRef.current.readyState ===
          WebSocket.CONNECTING
      )
    ) {
      return;
    }

    manuallyClosedRef.current = false;

    let socket;

    try {
      socket = new WebSocket(url);
    } catch (error) {
      console.error(
        "WebSocket creation failed:",
        error
      );

      setConnected(false);
      setStale(true);

      return;
    }

    socketRef.current = socket;

    socket.onopen = () => {
      console.log(
        "[AeroSynX] Telemetry WebSocket connected"
      );

      setConnected(true);
      setStale(false);

      /*
       * Tell the backend that this is a dashboard
       * client.
       */
      try {
        socket.send(
          JSON.stringify({
            type: "dashboard_connect",
            client: "aerosynx-dashboard",
          })
        );
      } catch (error) {
        console.warn(
          "Unable to send dashboard_connect:",
          error
        );
      }
    };

    socket.onmessage = (event) => {
      try {
        const data =
          typeof event.data === "string"
            ? JSON.parse(event.data)
            : event.data;

        /*
         * Ignore unrelated backend messages.
         */
        if (!data || typeof data !== "object") {
          return;
        }

        /*
         * Some WebSocket servers send status messages
         * before telemetry starts.
         */
        if (
          data.type === "connected" ||
          data.type === "status"
        ) {
          return;
        }

        setPacket((previous) => ({
          ...previous,
          ...data,

          reading: {
            ...(previous.reading || {}),
            ...(data.reading || {}),
          },

          source: {
            ...(previous.source || {}),
            ...(data.source || {}),
          },

          range_status: {
            ...(previous.range_status || {}),
            ...(data.range_status || {}),
          },

          context: {
            ...(previous.context || {}),
            ...(data.context || {}),
          },

          twin: {
            ...(previous.twin || {}),
            ...(data.twin || {}),
          },

          ai: {
            ...(previous.ai || {}),
            ...(data.ai || {}),
          },
        }));

        setStale(false);
      } catch (error) {
        console.error(
          "[AeroSynX] Invalid telemetry packet:",
          error,
          event.data
        );
      }
    };

    socket.onerror = (error) => {
      console.warn(
        "[AeroSynX] WebSocket error",
        error
      );

      setConnected(false);
    };

    socket.onclose = () => {
      console.warn(
        "[AeroSynX] Telemetry WebSocket disconnected"
      );

      setConnected(false);
      setStale(true);

      socketRef.current = null;

      /*
       * Automatically reconnect unless the component
       * has deliberately closed the socket.
       */
      if (!manuallyClosedRef.current) {
        reconnectTimerRef.current =
          window.setTimeout(() => {
            connect();
          }, 2000);
      }
    };
  }, [url]);

  /*
   * ----------------------------------------------------------
   * INITIAL CONNECTION
   * ----------------------------------------------------------
   */

  useEffect(() => {
    connect();

    return () => {
      manuallyClosedRef.current = true;

      if (reconnectTimerRef.current) {
        window.clearTimeout(
          reconnectTimerRef.current
        );
      }

      if (socketRef.current) {
        try {
          socketRef.current.close();
        } catch {
          // Ignore close errors.
        }
      }

      socketRef.current = null;
    };
  }, [connect]);

  /*
   * ----------------------------------------------------------
   * SEND MESSAGE
   * ----------------------------------------------------------
   */

  const send = useCallback((message) => {
    const socket = socketRef.current;

    if (!socket) {
      console.warn(
        "[AeroSynX] WebSocket is not connected."
      );

      return false;
    }

    if (
      socket.readyState !== WebSocket.OPEN
    ) {
      console.warn(
        "[AeroSynX] WebSocket is not open."
      );

      return false;
    }

    try {
      socket.send(
        JSON.stringify(message)
      );

      return true;
    } catch (error) {
      console.error(
        "[AeroSynX] Failed to send WebSocket message:",
        error
      );

      return false;
    }
  }, []);

  /*
   * ----------------------------------------------------------
   * RETURN API
   * ----------------------------------------------------------
   */

  return {
    packet,

    connected,

    stale,

    send,

    reconnect: connect,
  };
}

export default useTelemetrySocket;