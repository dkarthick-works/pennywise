import { useState, type FormEvent } from "react";
import { useNavigate } from "react-router-dom";
import { useAuth } from "../auth/AuthContext";
import { signup } from "../api/auth";
import { IconArrowR, IconEye, IconEyeOff } from "../components/ui/Icons";

type Mode = "signin" | "register";

export function AuthPage() {
  const { login } = useAuth();
  const navigate = useNavigate();
  const [mode, setMode] = useState<Mode>("signin");
  const [name, setName]   = useState("");
  const [email, setEmail] = useState("");
  const [pw, setPw]       = useState("");
  const [showPw, setShowPw] = useState(false);
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [loading, setLoading] = useState(false);
  const [serverErr, setServerErr] = useState("");

  const isReg = mode === "register";

  async function submit(e: FormEvent) {
    e.preventDefault();
    const er: Record<string, string> = {};
    if (isReg && name.trim().length < 2) er.name = "Enter your name";
    if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) er.email = "Enter a valid email";
    if (pw.length < 6) er.pw = "At least 6 characters";
    setErrors(er);
    if (Object.keys(er).length) return;

    setLoading(true);
    setServerErr("");
    try {
      if (isReg) {
        await signup({ email: email.trim(), password: pw });
        // After signup, Goauth sends a verification email; show a hint.
        setMode("signin");
        setServerErr("Account created — check your email to verify, then sign in.");
      } else {
        await login({ email: email.trim(), password: pw });
        navigate("/record");
      }
    } catch (err: unknown) {
      const msg =
        (err as { response?: { data?: { error?: string } } })?.response?.data?.error ??
        "Something went wrong. Please try again.";
      setServerErr(msg);
    } finally {
      setLoading(false);
    }
  }

  function switchMode() {
    setMode(isReg ? "signin" : "register");
    setErrors({});
    setServerErr("");
    setShowPw(false);
  }

  return (
    <div className="auth-wrap">
      <div className="auth-card fade-in">
        {/* logo */}
        <div className="auth-logo">
          <div className="logo-mark"><span>P</span></div>
          <div className="logo-word">Pennywise</div>
        </div>

        <h1 className="auth-title">{isReg ? "Create your account" : "Welcome back"}</h1>
        <p className="auth-sub">
          {isReg ? "Start tracking every rupee — in and out." : "Sign in to your Pennywise."}
        </p>

        <form onSubmit={submit} noValidate>
          {isReg && (
            <div className="field">
              <label>Full name</label>
              <input
                className={"input" + (errors.name ? " err" : "")}
                value={name} onChange={(e) => setName(e.target.value)}
                placeholder="Your name" autoComplete="off"
              />
              {errors.name && <div className="err-msg">{errors.name}</div>}
            </div>
          )}

          <div className="field">
            <label>Email</label>
            <input
              className={"input" + (errors.email ? " err" : "")}
              type="email" value={email} onChange={(e) => setEmail(e.target.value)}
              placeholder="you@email.com" autoComplete="off"
            />
            {errors.email && <div className="err-msg">{errors.email}</div>}
          </div>

          <div className="field">
            <label>Password</label>
            <div className="input-wrap">
              <input
                className={"input" + (errors.pw ? " err" : "")}
                type={showPw ? "text" : "password"}
                value={pw}
                onChange={(e) => setPw(e.target.value)}
                placeholder="••••••••"
                autoComplete={isReg ? "new-password" : "current-password"}
              />
              <button
                type="button"
                className="input-toggle"
                onClick={() => setShowPw((v) => !v)}
                aria-label={showPw ? "Hide password" : "Show password"}
              >
                {showPw ? <IconEyeOff size={18} /> : <IconEye size={18} />}
              </button>
            </div>
            {errors.pw && <div className="err-msg">{errors.pw}</div>}
          </div>

          {serverErr && (
            <div
              className={serverErr.startsWith("Account") ? "auth-hint" : "err-msg"}
              style={{ marginBottom: 10 }}
            >
              {serverErr}
            </div>
          )}

          <button className="btn btn-primary" type="submit" disabled={loading} style={{ marginTop: 6 }}>
            {loading ? "Please wait…" : isReg ? "Create account" : "Sign in"}
            {!loading && <IconArrowR size={16} />}
          </button>
        </form>

        <div className="auth-switch">
          {isReg ? "Already have an account?" : "New to Pennywise?"}
          <button onClick={switchMode}>{isReg ? "Sign in" : "Create one"}</button>
        </div>
      </div>
    </div>
  );
}
