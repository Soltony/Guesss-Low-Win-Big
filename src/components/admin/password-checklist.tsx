'use client';

import { Check, X } from 'lucide-react';
import { cn } from '@/lib/utils';
import { PASSWORD_MIN_LENGTH } from '@/lib/admin-users';

/**
 * The composition rules of the password policy, ticked off while the user
 * types. The server applies the whole policy — common passwords and keyboard
 * runs included — and says so when one of those is the problem.
 */
const RULES = [
  { label: `At least ${PASSWORD_MIN_LENGTH} characters`, test: (v: string) => v.length >= PASSWORD_MIN_LENGTH },
  { label: 'A lowercase letter', test: (v: string) => /[a-z]/.test(v) },
  { label: 'An uppercase letter', test: (v: string) => /[A-Z]/.test(v) },
  { label: 'A number', test: (v: string) => /[0-9]/.test(v) },
  { label: 'A symbol', test: (v: string) => /[^A-Za-z0-9]/.test(v) },
];

export function passwordMeetsRules(password: string) {
  return RULES.every((rule) => rule.test(password));
}

export function PasswordChecklist({ password }: { password: string }) {
  return (
    <ul className="space-y-1">
      {RULES.map((rule) => {
        const passed = rule.test(password);
        return (
          <li
            key={rule.label}
            className={cn(
              'flex items-center gap-1.5 text-xs',
              passed ? 'text-success' : 'text-muted-foreground'
            )}
          >
            {passed ? <Check className="h-3.5 w-3.5" /> : <X className="h-3.5 w-3.5" />}
            {rule.label}
          </li>
        );
      })}
    </ul>
  );
}
