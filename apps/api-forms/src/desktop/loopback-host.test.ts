import { describe, expect, it } from 'vitest';
import { isLoopbackHost } from './loopback-host.js';

describe('the loopback name', () => {
  it.each([
    ['127.0.0.1:47017', true],
    ['localhost:47017', true],
    ['LOCALHOST:47017', true],
    ['[::1]:47017', true],
    ['127.0.0.1:47018', false],
    ['127.0.0.1', false],
    ['evil.example:47017', false],
    ['127.0.0.1.evil.example:47017', false],
    ['192.168.1.20:47017', false],
    ['', false],
    [undefined, false],
  ])('%j → %s', (host, expected) => {
    expect(isLoopbackHost(host, 47017)).toBe(expected);
  });
});
