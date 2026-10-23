"use client";

import { useActionState } from "react";

import { sendMagicLink, type SignInState } from "@/app/actions/auth";
import { FormError } from "@/components/form-error";
import { SubmitButton } from "@/components/submit-button";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { t } from "@/i18n";

const MAILPIT_URL = "http://localhost:54324";

export function SignInForm({ next, linkFailed }: { next: string; linkFailed: boolean }) {
  const [state, action] = useActionState<SignInState, FormData>(sendMagicLink, { status: "idle" });

  if (state.status === "sent") {
    return (
      <Card>
        <CardHeader>
          <CardTitle>{t.auth.sentTitle}</CardTitle>
        </CardHeader>
        <CardContent className="flex flex-col gap-4">
          <p>{t.auth.sent(state.email)}</p>
          {process.env.NODE_ENV !== "production" && (
            <p className="text-muted-foreground text-sm">
              {t.auth.localHint}{" "}
              <a
                className="text-primary underline"
                href={MAILPIT_URL}
                target="_blank"
                rel="noreferrer"
              >
                {MAILPIT_URL}
              </a>
            </p>
          )}
          <Button variant="outline" onClick={() => window.location.reload()}>
            {t.auth.tryAgain}
          </Button>
        </CardContent>
      </Card>
    );
  }

  return (
    <Card>
      <CardHeader>
        <CardTitle>{t.auth.title}</CardTitle>
      </CardHeader>
      <CardContent>
        <form action={action} className="flex flex-col gap-4">
          <p className="text-muted-foreground text-sm">{t.auth.intro}</p>
          {linkFailed && <FormError message={t.auth.linkFailed} />}
          <input type="hidden" name="neste" value={next} />
          <div className="flex flex-col gap-2">
            <Label htmlFor="email">{t.auth.email}</Label>
            <Input
              id="email"
              name="email"
              type="email"
              autoComplete="email"
              placeholder={t.auth.emailPlaceholder}
              required
            />
          </div>
          {state.status === "error" && <FormError message={state.message} />}
          <SubmitButton pendingText={t.auth.sending}>{t.auth.send}</SubmitButton>
        </form>
      </CardContent>
    </Card>
  );
}
