---
title: goroutine 与 channel 的三条硬规矩
description: 谁能关 channel、什么时候该用缓冲、为什么 select 里必须有 default——把并发里最容易踩的坑钉在墙上。
date: 2026-09-20
tags: [Go, 并发]
draft: false
progress: 《Go 程序设计语言》第 8 章读后
---

## 规矩一：只由发送方关闭 channel

channel 是"值的管道"，关闭它的语义只有一句话：不会再有值了。这个信息只有发送方能给出。由接收方去关，发送方下一次 `ch <- v` 就会 panic：`send on closed channel`。

```go
// 对：生产者在自己的 goroutine 里 close
func produce(ch chan<- int, n int) {
	defer close(ch)
	for i := 0; i < n; i++ {
		ch <- i
	}
}

// 错：消费者关掉了别人还在写的 channel
func wrong(ch chan int) {
	for range ch {
		break
	}
	close(ch) // 之后任何发送都会 panic
}
```

需要"通知生产者停止"时，用**另一个 channel** 传信号，而不是关数据 channel：

```go
done := make(chan struct{})

go func() {
	defer close(done)
	for v := range work {
		if v == stop { return }
		process(v)
	}
}()

// 消费者想提前退出，就关 done，让生产者自己决定收尾
```

## 规矩二：缓冲大小是设计参数，不是性能旋钮

无缓冲 channel 是一次**同步交接**：发送方阻塞到有人接收。缓冲 channel 是**队列**：发送方只要队列没满就不阻塞。两者的语义不同，不只是快慢不同。

```go
unbuffered := make(chan int)     // 交接：发送与接收必须同时在场
queued := make(chan int, 8)      // 排队：最多攒 8 个
```

由此推出两个常被忽略的结论：

- 无缓冲 channel 的 `cap` 是 0，`len` 恒为 0，`close` 之后读出来的是零值且 `ok == false`。
- 缓冲满了照样阻塞。把缓冲开成 `make(chan T, 100000)` 来"避免阻塞"，只是把背压推迟到内存耗尽的那一刻，问题从卡住变成 OOM。

想限制并发数，用 token 型的信号量，而不是加大缓冲：

```go
sem := make(chan struct{}, 4) // 最多 4 个并发

for _, job := range jobs {
	sem <- struct{}{}
	go func(j Job) {
		defer func() { <-sem }()
		handle(j)
	}(job)
}
```

## 规矩三：select 里没有 default 才是常态

```go
select {
case v := <-a:
	use(v)
case b <- x:
	// 已投递
case <-time.After(time.Second):
	// 超时
}
```

带 `default` 的 select **永不阻塞**，会立刻走 default 分支。这在"非阻塞探测"里是特性：

```go
select {
case v := <-ch:
	// 有值
default:
	// 没值，立刻返回
}
```

但在循环里把 `default` 当兜底，就变成了 CPU 空转：

```go
for {
	select {
	case v := <-ch:
		handle(v)
	default: // 这一行让循环变成忙等
	}
}
```

真要"超时退出"，用 `time.After` 或 `context.WithTimeout`，别用 `default`。

## 收尾：把泄漏当成 bug 而不是意外

goroutine 泄漏不会报错，只会让内存和文件描述符慢慢涨。两个自查点：

- 每个 `go func()` 都要能回答：**它什么时候退出**？退不出的，就是泄漏。
- 每个 `for range ch` 都要能回答：**谁负责 close**？没人 close，它就永远挂着。

```bash
# 跑测试时带上竞态检测
go test -race ./...
```

`-race` 抓的是数据竞争，抓不到 goroutine 泄漏。泄漏得靠 `runtime.NumGoroutine()` 或 `goleak` 这类工具在测试收尾时断言。
