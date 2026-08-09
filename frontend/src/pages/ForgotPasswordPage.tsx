import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { forgotPassword } from "../api/auth";
import { IconArrowR, IconMail } from "../components/ui/Icons";

type Status = "idle" | "sending" | "sent" | "error";

export function ForgotPasswordPage() {
  const navigate = useNavigate();
  const [email, setEmail] = useState("");
  const [error, setError] = useState("");
  const [status, setStatus] = useState<Status>("idle");

  async function submit(e: FormEvent) {
    e.preventDefault();
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
      setError("Enter a valid email");
      return;
    }
    setError("");
    setStatus("sending");
    try {
      await forgotPassword({ email: email.trim() });
      // Only reached on a confirmed 2xx — Goauth always returns 200 here to
      // avoid leaking whether the email is registered, so this copy stays
      // deliberately non-committal either way.
      setStatus("sent");
    } catch {
      // Network error, proxy failure, or a 5xx from Goauth — distinct from
      // "sent" so we never claim success for a request that never landed.
      setStatus("error");
    }
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card fade-in">
        <div className="auth-logo">
          <div className="logo-word">pennywise</div>
        </div>

        {status === "sent" ? (
          <>
            <div className="auth-hint">
              If an account exists for that email, we've sent a link to reset your password.
              It expires in 30 minutes.
            </div>
            <div className="auth-switch">
              <button type="button" onClick={() => navigate("/login")}>Back to sign in</button>
            </div>
          </>
        ) : (
          <form onSubmit={submit} noValidate>
            <div className="field">
              <label htmlFor="forgot-email">Email</label>
              <div className="input-wrap input-wrap--lead">
                <span className="input-lead" aria-hidden="true">
                  <IconMail size={17} />
                </span>
                <input
                  id="forgot-email"
                  className={"input" + (error ? " err" : "")}
                  type="email" value={email} onChange={(e) => setEmail(e.target.value)}
                  placeholder="you@email.com" autoComplete="off" autoFocus
                />
              </div>
              {error && <div className="err-msg">{error}</div>}
            </div>

            {status === "error" && (
              <div className="err-msg" style={{ marginBottom: 10 }}>
                Something went wrong — please try again in a moment.
              </div>
            )}

            <button className="btn btn-primary auth-submit" type="submit" disabled={status === "sending"}>
              {status === "sending" ? "Sending…" : "Send reset link"}
              {status !== "sending" && <IconArrowR size={16} />}
            </button>

            <div className="auth-switch">
              <button type="button" onClick={() => navigate("/login")}>Back to sign in</button>
            </div>
          </form>
        )}
      </div>
    </div>
  );
}
