import { useMotionValue, useReducedMotion, useTransform } from 'motion/react';
import { type PointerEvent, useCallback, useEffect, useState } from 'react';

type PermissionState = 'unsupported' | 'needs-permission' | 'on';

interface OrientationEventWithPermission {
  requestPermission?: () => Promise<'granted' | 'denied'>;
}

/**
 * Card tilt from the gyroscope (TZ 13), with touch/pointer as the fallback. iOS asks for permission,
 * which must be requested from a user gesture (`enableGyro`).
 */
export function useTilt() {
  const reduced = useReducedMotion() ?? false;
  const x = useMotionValue(0);
  const y = useMotionValue(0);
  const rotateX = useTransform(y, (v) => `${String(v * -14)}deg`);
  const rotateY = useTransform(x, (v) => `${String(v * 16)}deg`);
  const [gyro, setGyro] = useState<PermissionState>(() => {
    if (typeof DeviceOrientationEvent === 'undefined') return 'unsupported';
    const ctor = DeviceOrientationEvent as unknown as OrientationEventWithPermission;
    return typeof ctor.requestPermission === 'function' ? 'needs-permission' : 'on';
  });

  useEffect(() => {
    if (gyro !== 'on' || reduced) return;
    const onOrientation = (e: DeviceOrientationEvent) => {
      if (e.beta === null || e.gamma === null) return;
      x.set(Math.max(-1, Math.min(1, e.gamma / 30)));
      y.set(Math.max(-1, Math.min(1, (e.beta - 45) / 30)));
    };
    window.addEventListener('deviceorientation', onOrientation);
    return () => {
      window.removeEventListener('deviceorientation', onOrientation);
    };
  }, [gyro, reduced, x, y]);

  const enableGyro = useCallback(async () => {
    const ctor = DeviceOrientationEvent as unknown as OrientationEventWithPermission;
    try {
      if ((await ctor.requestPermission?.()) === 'granted') setGyro('on');
    } catch {
      // Denied or not allowed in this webview: touch tilt still works.
    }
  }, []);

  const onPointerMove = (e: PointerEvent<HTMLElement>) => {
    if (reduced) return;
    const rect = e.currentTarget.getBoundingClientRect();
    x.set(((e.clientX - rect.left) / rect.width - 0.5) * 2);
    y.set(((e.clientY - rect.top) / rect.height - 0.5) * 2);
  };
  const onPointerLeave = () => {
    if (gyro === 'on') return;
    x.set(0);
    y.set(0);
  };

  return {
    style: { rotateX, rotateY, transformPerspective: 900 },
    onPointerMove,
    onPointerLeave,
    gyro,
    enableGyro,
  };
}
