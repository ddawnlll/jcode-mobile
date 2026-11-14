//! Small, dependency-free latency tracker for diagnostics.
//!
//! Samples are durations in milliseconds, bounded by a fixed ring. Percentiles
//! are recomputed only when a diagnostics snapshot is requested, so the hot
//! path is a push and a truncation.

use std::collections::VecDeque;
use std::sync::Mutex;

#[derive(Debug)]
pub struct LatencyTracker {
    samples: Mutex<VecDeque<u64>>,
    capacity: usize,
}

impl Default for LatencyTracker {
    fn default() -> Self {
        Self::new(256)
    }
}

impl LatencyTracker {
    pub fn new(capacity: usize) -> Self {
        Self {
            samples: Mutex::new(VecDeque::with_capacity(capacity.max(16))),
            capacity: capacity.max(16),
        }
    }

    pub fn record(&self, millis: u64) {
        let mut samples = self.samples.lock().expect("latency samples");
        samples.push_back(millis);
        while samples.len() > self.capacity {
            samples.pop_front();
        }
    }

    pub fn len(&self) -> usize {
        self.samples.lock().expect("latency samples").len()
    }

    pub fn is_empty(&self) -> bool {
        self.len() == 0
    }

    /// (p50, p95). `None` when no samples have been recorded; never invented.
    pub fn percentiles(&self) -> (Option<u64>, Option<u64>) {
        let mut values: Vec<u64> = self
            .samples
            .lock()
            .expect("latency samples")
            .iter()
            .copied()
            .collect();
        if values.is_empty() {
            return (None, None);
        }
        values.sort_unstable();
        (Some(percentile(&values, 50)), Some(percentile(&values, 95)))
    }
}

fn percentile(sorted: &[u64], percent: usize) -> u64 {
    let rank = (sorted.len() * percent).div_ceil(100).max(1);
    sorted[rank.min(sorted.len()) - 1]
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn empty_tracker_has_no_percentiles() {
        let tracker = LatencyTracker::new(8);
        assert_eq!(tracker.percentiles(), (None, None));
    }

    #[test]
    fn percentiles_are_computed_from_real_samples() {
        let tracker = LatencyTracker::new(100);
        for value in 1..=100 {
            tracker.record(value);
        }
        let (p50, p95) = tracker.percentiles();
        assert_eq!(p50, Some(50));
        assert_eq!(p95, Some(95));
    }

    #[test]
    fn ring_is_bounded() {
        let tracker = LatencyTracker::new(16);
        for value in 0..100 {
            tracker.record(value);
        }
        assert_eq!(tracker.len(), 16);
        let (p50, _) = tracker.percentiles();
        assert_eq!(p50, Some(91));
    }
}
