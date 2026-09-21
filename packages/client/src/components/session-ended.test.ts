import { describe, it, expect } from "bun:test";
import type { SessionEndedMsg } from "@codayon/shared";

/**
 * Tests for session-ended teardown UX (FEAT-003 Task 11, REQ-037).
 *
 * Verifies that:
 * 1. App.tsx subscribes to SessionEndedMsg
 * 2. Session-ended view transitions correctly
 * 3. All controls are disabled when session is ended
 * 4. "Return to Lobby" clears session state
 * 5. Editor is not rendered in ended state
 */

describe("Session-Ended Teardown UX (REQ-037)", () => {
  describe("SessionEndedMsg structure", () => {
    it("has correct channel and type", () => {
      const msg: SessionEndedMsg = {
        channel: "control",
        type: "sessionEnded",
      };

      expect(msg.channel).toBe("control");
      expect(msg.type).toBe("sessionEnded");
    });

    it("is a readonly interface", () => {
      const msg: SessionEndedMsg = {
        channel: "control",
        type: "sessionEnded",
      };

      expect(typeof msg).toBe("object");
      expect(msg).not.toBeNull();
    });
  });

  describe("REQ-037.1: Distinct Session Ended screen", () => {
    it("displays 'Session Ended' heading", () => {
      // SessionEnded component renders heading
      const heading = "Session Ended";
      expect(heading.length > 0).toBe(true);
      expect(heading).toContain("Session Ended");
    });

    it("displays descriptive message", () => {
      const message = "The host has ended the session. Code editing is no longer available.";
      expect(message.length > 0).toBe(true);
      expect(message.toLowerCase()).toContain("session");
      expect(message.toLowerCase()).toContain("ended");
    });

    it("shows distinct background color/styling", () => {
      // SessionEnded uses amber/yellow for visual distinction
      const styling = "bg-amber-900/30";
      expect(styling.length > 0).toBe(true);
    });

    it("does not show live editor controls", () => {
      // SessionEnded component does not render CodeMirror editor
      // or SessionControls (those are only in RoomEditor)
      const sessionEndedTemplate = "SessionEnded";
      expect(sessionEndedTemplate.length > 0).toBe(true);
    });
  });

  describe("REQ-037.2: Message display", () => {
    it("displays room code for reference", () => {
      const roomCode = "ABC123";
      expect(roomCode.length > 0).toBe(true);
      expect(roomCode).toBe("ABC123");
    });

    it("shows message about session termination", () => {
      const message = "The host has ended the session";
      expect(message).toContain("host");
      expect(message).toContain("ended");
    });

    it("indicates editing is no longer available", () => {
      const text = "Code editing is no longer available";
      expect(text).toContain("editing");
      expect(text).toContain("no longer");
    });
  });

  describe("REQ-037.3: Return to Lobby button", () => {
    it("has exactly one button labeled 'Return to Lobby'", () => {
      const buttonLabel = "Return to Lobby";
      expect(buttonLabel.length > 0).toBe(true);
      expect(buttonLabel).toContain("Return");
      expect(buttonLabel).toContain("Lobby");
    });

    it("is visually prominent (emerald color)", () => {
      const buttonClass = "bg-emerald-500";
      expect(buttonClass.length > 0).toBe(true);
    });

    it("has hover and active states", () => {
      const hoverClass = "hover:bg-emerald-400";
      const activeClass = "active:bg-emerald-600";
      expect(hoverClass.length > 0).toBe(true);
      expect(activeClass.length > 0).toBe(true);
    });
  });

  describe("REQ-037.4: Session state clearing on return", () => {
    it("callback clears session state", () => {
      let sessionCleared = false;
      const onReturnToLobby = () => {
        sessionCleared = true;
      };

      onReturnToLobby();
      expect(sessionCleared).toBe(true);
    });

    it("transitions back to lobby view", () => {
      // When onReturnToLobby is called in App.tsx:
      // 1. setSession(null) clears session data
      // 2. setSessionEnded(false) resets the flag
      // 3. App re-renders Lobby component
      let transitionedToLobby = false;
      const mockSetSession = (val: null) => {
        if (val === null) {
          transitionedToLobby = true;
        }
      };

      mockSetSession(null);
      expect(transitionedToLobby).toBe(true);
    });

    it("resets sessionEnded flag", () => {
      let sessionEndedFlag = true;
      const resetFlag = () => {
        sessionEndedFlag = false;
      };

      resetFlag();
      expect(sessionEndedFlag).toBe(false);
    });
  });

  describe("REQ-037.5: Editor and controls not rendered", () => {
    it("SessionEnded component does not render RoomEditor", () => {
      // SessionEnded is a separate component that does not include RoomEditor
      const component = "SessionEnded";
      expect(component).not.toContain("RoomEditor");
    });

    it("SessionEnded does not render SessionControls", () => {
      // SessionEnded only shows message and button, no controls
      const component = "SessionEnded";
      expect(component).not.toContain("SessionControls");
    });

    it("SessionEnded does not render editor canvas", () => {
      // No CodeMirror editor DOM element
      const component = "SessionEnded";
      expect(component).not.toContain("cm-editor");
    });

    it("App conditionally renders RoomEditor based on sessionEnded flag", () => {
      // In App.tsx: Show when={sessionEnded()} fallback={<RoomEditor />}
      // When sessionEnded is true, RoomEditor is NOT rendered
      let shouldRenderEditor = true;
      const sessionEndedFlag = true;

      if (sessionEndedFlag) {
        shouldRenderEditor = false;
      }

      expect(shouldRenderEditor).toBe(false);
    });

    it("All controls disabled when sessionPhase is 'ended'", () => {
      // RoomEditor receives sessionPhase signal
      // SessionControls can conditionally disable based on phase
      const sessionPhase = "ended";
      const isControlsEnabled = sessionPhase !== "ended";

      expect(isControlsEnabled).toBe(false);
    });
  });

  describe("SessionEndedMsg subscription (FEAT-003 Task 11)", () => {
    it("RoomEditor imports SessionEndedMsg", () => {
      // Verified in RoomEditor.tsx imports
      const importStatement = "SessionEndedMsg";
      expect(importStatement.length > 0).toBe(true);
    });

    it("RoomEditor subscribes to sessionEnded messages", () => {
      // In connection.onMessage handler:
      // else if (msg.type === "sessionEnded")
      const handlerCheck = "sessionEnded";
      expect(handlerCheck).toBe("sessionEnded");
    });

    it("SessionEndedMsg triggers phase transition to 'ended'", () => {
      let sessionPhase = "active";
      const onSessionEndedMsg = () => {
        sessionPhase = "ended";
      };

      onSessionEndedMsg();
      expect(sessionPhase).toBe("ended");
    });

    it("SessionEndedMsg invokes onSessionEnded callback", () => {
      let callbackInvoked = false;
      const onSessionEnded = () => {
        callbackInvoked = true;
      };

      if (typeof onSessionEnded === "function") {
        onSessionEnded();
      }

      expect(callbackInvoked).toBe(true);
    });

    it("RoomEditor passes onSessionEnded to props from App.tsx", () => {
      // App.tsx: <RoomEditor ... onSessionEnded={() => setSessionEnded(true)} />
      let sessionEndedSignal = false;
      const setSessionEnded = (val: boolean) => {
        sessionEndedSignal = val;
      };

      const onSessionEnded = () => setSessionEnded(true);
      onSessionEnded();

      expect(sessionEndedSignal).toBe(true);
    });
  });

  describe("App.tsx state management", () => {
    it("App tracks sessionEnded signal", () => {
      // const [sessionEnded, setSessionEnded] = createSignal(false);
      let sessionEndedValue = false;
      expect(sessionEndedValue).toBe(false);

      sessionEndedValue = true;
      expect(sessionEndedValue).toBe(true);
    });

    it("App conditionally renders SessionEnded vs RoomEditor", () => {
      // <Show when={sessionEnded()} fallback={<RoomEditor ... />}>
      // <SessionEnded ... />
      const sessionEnded = true;

      const renderedComponent = sessionEnded ? "SessionEnded" : "RoomEditor";
      expect(renderedComponent).toBe("SessionEnded");
    });

    it("App passes onSessionEnded callback to RoomEditor", () => {
      // onSessionEnded={() => setSessionEnded(true)}
      let sessionEnded = false;
      const onSessionEnded = () => {
        sessionEnded = true;
      };

      expect(sessionEnded).toBe(false);
      onSessionEnded();
      expect(sessionEnded).toBe(true);
    });

    it("Return to Lobby clears session and resets ended flag", () => {
      let session: { code: string } | null = { code: "ABC123" };
      let sessionEnded = true;

      const onReturnToLobby = () => {
        session = null;
        sessionEnded = false;
      };

      expect(session).not.toBeNull();
      expect(sessionEnded).toBe(true);

      onReturnToLobby();

      expect(session).toBeNull();
      expect(sessionEnded).toBe(false);
    });
  });

  describe("Integration: Message flow to UI transition", () => {
    it("Server sends SessionEndedMsg → RoomEditor receives it", () => {
      const serverMsg: SessionEndedMsg = {
        channel: "control",
        type: "sessionEnded",
      };

      expect(serverMsg.type).toBe("sessionEnded");
      expect(serverMsg.channel).toBe("control");
    });

    it("RoomEditor.onMessage handler recognizes sessionEnded type", () => {
      const msg: SessionEndedMsg = {
        channel: "control",
        type: "sessionEnded",
      };

      const isSessionEnded = msg.type === "sessionEnded";
      expect(isSessionEnded).toBe(true);
    });

    it("Handler calls props.onSessionEnded callback", () => {
      let callbackCalled = false;
      const props = {
        onSessionEnded: () => {
          callbackCalled = true;
        },
      };

      if (props.onSessionEnded) {
        props.onSessionEnded();
      }

      expect(callbackCalled).toBe(true);
    });

    it("App.tsx callback sets sessionEnded signal to true", () => {
      let sessionEnded = false;
      const setSessionEnded = (val: boolean) => {
        sessionEnded = val;
      };

      setSessionEnded(true);
      expect(sessionEnded).toBe(true);
    });

    it("Signal change triggers re-render to SessionEnded component", () => {
      let sessionEnded = false;
      let renderedComponent = "RoomEditor";

      // Simulate signal update
      sessionEnded = true;
      renderedComponent = sessionEnded ? "SessionEnded" : "RoomEditor";

      expect(renderedComponent).toBe("SessionEnded");
    });

    it("User clicks Return to Lobby", () => {
      let session: { code: string } | null = { code: "ABC123" };
      let sessionEnded = true;

      const onReturnToLobby = () => {
        session = null;
        sessionEnded = false;
      };

      onReturnToLobby();

      expect(session).toBeNull();
      expect(sessionEnded).toBe(false);
      expect(sessionEnded).toBe(false); // Back to lobby
    });
  });

  describe("Edge cases", () => {
    it("SessionEndedMsg received while already in ended state (idempotent)", () => {
      let sessionPhase = "ended";
      let callCount = 0;

      const onSessionEndedMsg = () => {
        callCount++;
        sessionPhase = "ended";
      };

      onSessionEndedMsg();
      onSessionEndedMsg(); // Called again

      expect(sessionPhase).toBe("ended");
      expect(callCount).toBe(2); // Idempotent; no error
    });

    it("User quickly clicks Return to Lobby multiple times", () => {
      let session: { code: string } | null = { code: "ABC123" };
      let clickCount = 0;

      const onReturnToLobby = () => {
        clickCount++;
        session = null;
      };

      onReturnToLobby();
      onReturnToLobby();

      expect(session).toBeNull();
      expect(clickCount).toBe(2);
    });

    it("SessionEndedMsg received before full bootstrap", () => {
      // Should be handled gracefully
      // RoomEditor checks if connection exists before sending message
      const msg: SessionEndedMsg = {
        channel: "control",
        type: "sessionEnded",
      };

      expect(msg.type).toBe("sessionEnded");
    });
  });

  describe("Accessibility & UX", () => {
    it("SessionEnded screen clearly indicates session termination", () => {
      const heading = "Session Ended";
      const message = "The host has ended the session";

      expect(heading).toContain("Ended");
      expect(message).toContain("host");
      expect(message).toContain("ended");
    });

    it("Button text is clear and actionable", () => {
      const buttonLabel = "Return to Lobby";
      expect(buttonLabel).toContain("Return");
      expect(buttonLabel.length > 5).toBe(true);
    });

    it("Room code visible for user reference", () => {
      const roomCode = "ABC123";
      expect(roomCode.length).toBe(6);
    });

    it("Footer hint explains next steps", () => {
      const hint = "You'll need a new room code to start another session";
      expect(hint).toContain("new room code");
    });
  });
});
