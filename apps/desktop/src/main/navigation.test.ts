import { describe, expect, it } from 'vitest';
import {
  cameraAllowed,
  classifyNavigation,
  classifyOpen,
  externalAllowed,
  permissionAllowed,
} from './navigation.js';

const origins = ['http://127.0.0.1:47017', 'http://127.0.0.1:47018'];

describe('what leaves the app for the operating system', () => {
  it.each([
    ['https://loppa.se/help', true],
    ['http://example.com', true],
    ['mailto:asa@example.com', true],
    ['file:///C:/Windows/System32/calc.exe', false],
    ['smb://attacker/share/payload.exe', false],
    ['search-ms:query=x&crumb=location:\\\\attacker\\share', false],
    ['ms-msdt:/id PCWDiagnostic', false],
    ['javascript:alert(1)', false],
    ['not a url', false],
  ])('%s → %s', (url, expected) => {
    expect(externalAllowed(url)).toBe(expected);
  });
});

describe('a new window', () => {
  it('opens our own pages in a window of ours', () => {
    expect(classifyOpen('http://127.0.0.1:47017/f/varmotet', origins)).toEqual({
      action: 'window',
      pdfViewer: false,
    });
    expect(classifyOpen('http://127.0.0.1:47018/s/abc', origins).action).toBe('window');
  });

  it('opens a PDF our page made in a window with the PDF viewer', () => {
    expect(
      classifyOpen('blob:http://127.0.0.1:47017/6d1c0b4e-1111-4111-8111-111111111111', origins),
    ).toEqual({
      action: 'window',
      pdfViewer: true,
    });
  });

  it('refuses a blob made by any other page', () => {
    expect(classifyOpen('blob:https://evil.example/6d1c0b4e', origins).action).toBe('deny');
    expect(classifyOpen('blob:http://127.0.0.1:9999/6d1c0b4e', origins).action).toBe('deny');
  });

  it('hands other websites to the browser, and nothing else to anything', () => {
    expect(classifyOpen('https://example.com', origins).action).toBe('external');
    expect(classifyOpen('http://127.0.0.1.evil.example:47017/', origins).action).toBe('external');
    // Not a URL at all (a port cannot have a dot in it), so it goes nowhere.
    expect(classifyOpen('http://127.0.0.1:47017.evil.example/', origins).action).toBe('deny');
    expect(classifyOpen('file:///etc/passwd', origins).action).toBe('deny');
    expect(classifyOpen('smb://x/y', origins).action).toBe('deny');
  });
});

describe('a page navigating itself', () => {
  it('moves between our pages', () => {
    expect(
      classifyNavigation('http://127.0.0.1:47017/app', 'http://127.0.0.1:47017/f/x', origins),
    ).toBe('allow');
  });

  it('sends a website to the browser and refuses other schemes', () => {
    expect(classifyNavigation('http://127.0.0.1:47017/app', 'https://example.com', origins)).toBe(
      'external',
    );
    expect(classifyNavigation('http://127.0.0.1:47017/app', 'file:///C:/x.html', origins)).toBe(
      'deny',
    );
  });

  it('never lets the settings panel navigate — a dropped file would inherit its bridge', () => {
    const panel = 'file:///C:/Program%20Files/Loppa/resources/panel/index.html?view=settings';
    expect(classifyNavigation(panel, 'file:///C:/Users/x/Downloads/evil.html', origins)).toBe(
      'deny',
    );
    expect(classifyNavigation(panel, 'http://127.0.0.1:47017/app', origins)).toBe('deny');
    expect(classifyNavigation(panel, 'https://example.com', origins)).toBe('deny');
  });
});

describe('the camera', () => {
  it('is granted to our pages for video only', () => {
    expect(cameraAllowed('media', 'http://127.0.0.1:47017/door', ['video'], origins)).toBe(true);
    expect(cameraAllowed('media', 'http://127.0.0.1:47017/door', undefined, origins)).toBe(true);
  });

  it('is refused with the microphone, to other pages, and for other permissions', () => {
    expect(cameraAllowed('media', 'http://127.0.0.1:47017/door', ['video', 'audio'], origins)).toBe(
      false,
    );
    expect(cameraAllowed('media', 'http://127.0.0.1:47017/door', ['audio'], origins)).toBe(false);
    expect(cameraAllowed('media', 'https://evil.example/', ['video'], origins)).toBe(false);
    expect(cameraAllowed('geolocation', 'http://127.0.0.1:47017/', undefined, origins)).toBe(false);
    expect(cameraAllowed('notifications', 'http://127.0.0.1:47017/', undefined, origins)).toBe(
      false,
    );
  });
});

describe('other permissions', () => {
  it('lets our pages write to the clipboard, and nobody read it', () => {
    expect(
      permissionAllowed(
        'clipboard-sanitized-write',
        'http://127.0.0.1:47017/f/x',
        undefined,
        origins,
      ),
    ).toBe(true);
    expect(
      permissionAllowed('clipboard-sanitized-write', 'https://evil.example/', undefined, origins),
    ).toBe(false);
    expect(
      permissionAllowed('clipboard-read', 'http://127.0.0.1:47017/f/x', undefined, origins),
    ).toBe(false);
    expect(permissionAllowed('media', 'http://127.0.0.1:47017/door', ['video'], origins)).toBe(
      true,
    );
  });
});
