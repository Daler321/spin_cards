import { create } from 'zustand';

export type ToastKind = 'info' | 'success' | 'error';

interface ToastState {
  message: string | null;
  kind: ToastKind;
  show: (message: string, kind?: ToastKind) => void;
  hide: () => void;
}

let timer: ReturnType<typeof setTimeout> | undefined;

export const useToast = create<ToastState>((set) => ({
  message: null,
  kind: 'info',
  show: (message, kind = 'info') => {
    clearTimeout(timer);
    set({ message, kind });
    timer = setTimeout(() => {
      set({ message: null });
    }, 3200);
  },
  hide: () => {
    set({ message: null });
  },
}));
