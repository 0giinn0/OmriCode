/**
 * PanelSnap.ts
 * OmriCode — Windows-Style Panel Snap System
 *
 * Implements snap zones for the chat panel: right 50%, right 33%,
 * left 50%, left 33%, float (free), and auto-hide.
 */

export type SnapZone =
  | 'right-50'
  | 'right-33'
  | 'left-50'
  | 'left-33'
  | 'float'
  | 'hidden'
  | 'full';

interface SnapState {
  zone: SnapZone;
  /** Custom width when in 'float' mode (px) */
  floatWidth?: number;
  /** Custom height when in 'float' mode (px) */
  floatHeight?: number;
  /** X position when in 'float' mode */
  floatX?: number;
  /** Y position when in 'float' mode */
  floatY?: number;
}

export class PanelSnap {
  private state: SnapState = {
    zone: 'right-50',
    floatWidth: 480,
    floatHeight: 600,
    floatX: undefined,
    floatY: undefined
  };
  private onStateChange: ((state: SnapState) => void) | null = null;

  /** Snap zone to CSS property mapping */
  private static readonly SNAP_STYLES: Record<SnapZone, Record<string, string>> = {
    'right-50': {
      width: '50vw',
      height: '100vh',
      right: '0',
      left: 'auto',
      top: '0',
      bottom: '0',
      position: 'fixed',
      borderRadius: '0'
    },
    'right-33': {
      width: '33.33vw',
      height: '100vh',
      right: '0',
      left: 'auto',
      top: '0',
      bottom: '0',
      position: 'fixed',
      borderRadius: '0'
    },
    'left-50': {
      width: '50vw',
      height: '100vh',
      left: '0',
      right: 'auto',
      top: '0',
      bottom: '0',
      position: 'fixed',
      borderRadius: '0'
    },
    'left-33': {
      width: '33.33vw',
      height: '100vh',
      left: '0',
      right: 'auto',
      top: '0',
      bottom: '0',
      position: 'fixed',
      borderRadius: '0'
    },
    'float': {
      width: '480px',
      height: '600px',
      position: 'fixed',
      borderRadius: '8px',
      bottom: '40px',
      right: '40px',
      top: 'auto',
      left: 'auto',
      boxShadow: '0 25px 80px rgba(0,0,0,0.5)'
    },
    'hidden': {
      width: '0',
      height: '0',
      opacity: '0',
      pointerEvents: 'none'
    },
    'full': {
      width: '100vw',
      height: '100vh',
      top: '0',
      left: '0',
      right: '0',
      bottom: '0',
      position: 'fixed',
      borderRadius: '0',
      zIndex: '9999'
    }
  };



  /**
   * Get current snap zone.
   */
  getZone(): SnapZone {
    return this.state.zone;
  }

  /**
   * Set a callback for snap state changes.
   */
  onDidChangeState(callback: (state: SnapState) => void): void {
    this.onStateChange = callback;
  }

  /**
   * Switch to a snap zone.
   */
  snapTo(zone: SnapZone): void {
    this.state.zone = zone;
    this.onStateChange?.(this.state);
  }

  /**
   * Cycle through snap zones (for keyboard shortcut).
   * right-50 → right-33 → left-33 → left-50 → float → right-50
   */
  cycleForward(): void {
    const order: SnapZone[] = ['right-50', 'right-33', 'left-33', 'left-50', 'float'];
    const idx = order.indexOf(this.state.zone);
    const next = order[(idx + 1) % order.length];
    this.snapTo(next);
  }

  /**
   * Cycle backward through snap zones.
   */
  cycleBackward(): void {
    const order: SnapZone[] = ['right-50', 'right-33', 'left-33', 'left-50', 'float'];
    const idx = order.indexOf(this.state.zone);
    const next = order[(idx - 1 + order.length) % order.length];
    this.snapTo(next);
  }

  /**
   * Toggle between current zone and hidden.
   */
  private previousZone: SnapZone = 'right-50';

  toggleVisibility(): void {
    if (this.state.zone === 'hidden') {
      this.snapTo(this.previousZone);
    } else {
      this.previousZone = this.state.zone;
      this.snapTo('hidden');
    }
  }

  toggleFullscreen(): void {
    if (this.state.zone === 'full') {
      this.snapTo(this.previousZone);
    } else {
      this.previousZone = this.state.zone;
      this.snapTo('full');
    }
  }

  /**
   * Get the CSS custom properties for the current snap state.
   * These are applied to the panel container element.
   */
  getCSSProperties(): Record<string, string> {
    const styles = PanelSnap.SNAP_STYLES[this.state.zone];
    const props: Record<string, string> = {};

    if (styles.width) {
      props['--panel-width'] = styles.width;
    }
    if (styles.height) {
      props['--panel-height'] = styles.height;
    }

    // Clamp-based responsive sizing
    switch (this.state.zone) {
      case 'right-50':
      case 'left-50':
        props['--snap-width'] = '50vw';
        props['--font-scale'] = '1';
        break;
      case 'right-33':
      case 'left-33':
        props['--snap-width'] = '33.33vw';
        props['--font-scale'] = '0.9';
        break;
      case 'float':
        props['--snap-width'] = '480px';
        props['--font-scale'] = '1';
        break;
      case 'full':
        props['--snap-width'] = '100vw';
        props['--font-scale'] = '1.1';
        break;
      case 'hidden':
        props['--snap-width'] = '0';
        props['--font-scale'] = '0';
        break;
    }

    return props;
  }

  /**
   * Get all available snap zones with their keyboard shortcuts.
   */
  static getSnapOptions(): { zone: SnapZone; label: string; shortcut: string }[] {
    return [
      { zone: 'right-50', label: 'Right 50%', shortcut: 'Win+→' },
      { zone: 'right-33', label: 'Right 33%', shortcut: 'Win+Alt+→' },
      { zone: 'left-50', label: 'Left 50%', shortcut: 'Win+←' },
      { zone: 'left-33', label: 'Left 33%', shortcut: 'Win+Alt+←' },
      { zone: 'float', label: 'Float', shortcut: 'Win+↓' },
      { zone: 'full', label: 'Fullscreen', shortcut: 'Win+↑' },
      { zone: 'hidden', label: 'Auto-hide', shortcut: 'Win+.' }
    ];
  }
}
