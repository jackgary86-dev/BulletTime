/** Formats a simulated time in seconds as µs below 1 ms, otherwise ms. */
export function formatTime(seconds: number): string {
  const us = seconds * 1e6;
  return us < 1000 ? `${us.toFixed(0)} µs` : `${(us / 1000).toFixed(3)} ms`;
}
