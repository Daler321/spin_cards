const SEEN_KEY = 'spincards.onboardingSeen';

export function onboardingSeen(): boolean {
  try {
    return localStorage.getItem(SEEN_KEY) === '1';
  } catch {
    return false;
  }
}

export function markOnboardingSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY, '1');
  } catch {
    // Private mode: onboarding may show again, that's fine.
  }
}
