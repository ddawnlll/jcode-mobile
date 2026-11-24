package storage

import (
	"sync"
	"sync/atomic"
)

// BoundedQueue is a fixed-capacity, non-blocking FIFO channel wrapper that
// tracks dropped items under backpressure so slow consumers never OOM the gateway.
type BoundedQueue[T any] struct {
	ch      chan T
	dropped atomic.Uint64
	closed  atomic.Bool
	mu      sync.Mutex
}

func NewBoundedQueue[T any](capacity int) *BoundedQueue[T] {
	if capacity <= 0 {
		capacity = 64
	}
	return &BoundedQueue[T]{
		ch: make(chan T, capacity),
	}
}

// TryPush enqueues item without blocking. Returns false and increments Dropped when full or closed.
func (q *BoundedQueue[T]) TryPush(item T) bool {
	if q.closed.Load() {
		return false
	}
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed.Load() {
		return false
	}
	select {
	case q.ch <- item:
		return true
	default:
		q.dropped.Add(1)
		return false
	}
}

func (q *BoundedQueue[T]) Chan() <-chan T { return q.ch }
func (q *BoundedQueue[T]) Len() int       { return len(q.ch) }
func (q *BoundedQueue[T]) Cap() int       { return cap(q.ch) }
func (q *BoundedQueue[T]) Dropped() uint64 {
	return q.dropped.Load()
}

func (q *BoundedQueue[T]) Close() {
	q.mu.Lock()
	defer q.mu.Unlock()
	if q.closed.CompareAndSwap(false, true) {
		close(q.ch)
	}
}
