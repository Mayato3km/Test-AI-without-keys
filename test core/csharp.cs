using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Diagnostics;
using System.Linq;
using System.Net;
using System.Net.WebSockets;
using System.Text;
using System.Text.Json;
using System.Threading;
using System.Threading.Tasks;
using System.Runtime.InteropServices;

namespace MultiCoreController
{
    public class MultiCoreRequestController : IDisposable
    {
        private readonly int _maxThreads;
        private readonly BlockingCollection<WebSocketRequest> _requestQueue;
        private readonly List<Task> _workerTasks;
        private readonly CancellationTokenSource _cts;
        private readonly HttpListener _httpListener;
        private readonly string[] _prefixes;
        private readonly object _performanceLock = new object();
        private Dictionary<int, CorePerformance> _corePerformance;

        public class WebSocketRequest
        {
            public WebSocket WebSocket { get; set; }
            public string RequestId { get; set; }
            public string Payload { get; set; }
            public TaskCompletionSource<string> CompletionSource { get; set; }
        }

        public class CorePerformance
        {
            public int CoreId { get; set; }
            public long TotalProcessed { get; set; }
            public TimeSpan TotalProcessingTime { get; set; }
            public DateTime LastUpdate { get; set; }
        }

        public MultiCoreRequestController(int maxThreads = 0, params string[] prefixes)
        {
            _maxThreads = maxThreads > 0 ? maxThreads : Environment.ProcessorCount;
            _prefixes = prefixes.Length > 0 ? prefixes : new[] { "http://localhost:8080/" };
            
            _requestQueue = new BlockingCollection<WebSocketRequest>();
            _workerTasks = new List<Task>();
            _cts = new CancellationTokenSource();
            _corePerformance = new Dictionary<int, CorePerformance>();
            
            _httpListener = new HttpListener();
            foreach (var prefix in _prefixes)
            {
                _httpListener.Prefixes.Add(prefix);
            }
        }

        public async Task StartAsync()
        {
            Console.WriteLine($"Запуск контроллера с {_maxThreads} рабочими потоками");
            Console.WriteLine($"Доступно процессоров: {Environment.ProcessorCount}");
            
            // Инициализация мониторинга ядер
            InitializeCoreMonitoring();
            
            // Запуск рабочих потоков
            StartWorkerThreads();
            
            // Запуск HTTP сервера
            await StartHttpServerAsync();
        }

        private void InitializeCoreMonitoring()
        {
            for (int i = 0; i < Environment.ProcessorCount; i++)
            {
                _corePerformance[i] = new CorePerformance
                {
                    CoreId = i,
                    TotalProcessed = 0,
                    TotalProcessingTime = TimeSpan.Zero,
                    LastUpdate = DateTime.UtcNow
                };
            }
        }

        private void StartWorkerThreads()
        {
            for (int i = 0; i < _maxThreads; i++)
            {
                int threadId = i;
                var task = Task.Run(() => ProcessRequestsAsync(threadId, _cts.Token));
                _workerTasks.Add(task);
            }
        }

        private async Task ProcessRequestsAsync(int workerId, CancellationToken cancellationToken)
        {
            // Привязываем поток к конкретному ядру для лучшей производительности
            if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
            {
                SetThreadAffinity(workerId % Environment.ProcessorCount);
            }

            Console.WriteLine($"Рабочий поток {workerId} запущен на ядре {workerId % Environment.ProcessorCount}");

            while (!cancellationToken.IsCancellationRequested)
            {
                try
                {
                    var request = _requestQueue.Take(cancellationToken);
                    await ProcessSingleRequestAsync(workerId, request, cancellationToken);
                }
                catch (OperationCanceledException)
                {
                    break;
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Ошибка в рабочем потоке {workerId}: {ex.Message}");
                }
            }
        }

        private async Task ProcessSingleRequestAsync(int workerId, WebSocketRequest request, CancellationToken cancellationToken)
        {
            var stopwatch = Stopwatch.StartNew();
            int coreId = workerId % Environment.ProcessorCount;

            try
            {
                // Парсим запрос от JavaScript
                var jsRequest = JsonSerializer.Deserialize<JsRequest>(request.Payload);
                
                // Обрабатываем запрос
                var result = await ProcessRequestAsync(jsRequest, workerId, cancellationToken);
                
                // Отправляем результат обратно
                var response = new JsResponse
                {
                    RequestId = request.RequestId,
                    Result = result,
                    WorkerId = workerId,
                    CoreId = coreId,
                    ProcessingTime = stopwatch.ElapsedMilliseconds
                };

                var jsonResponse = JsonSerializer.Serialize(response);
                var buffer = Encoding.UTF8.GetBytes(jsonResponse);
                
                await request.WebSocket.SendAsync(
                    new ArraySegment<byte>(buffer),
                    WebSocketMessageType.Text,
                    true,
                    cancellationToken
                );

                // Обновляем статистику производительности
                UpdateCorePerformance(coreId, stopwatch.Elapsed);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Ошибка обработки запроса: {ex.Message}");
                // Отправляем ошибку клиенту
                await SendErrorAsync(request.WebSocket, request.RequestId, ex.Message, cancellationToken);
            }
        }

        private async Task<object> ProcessRequestAsync(JsRequest request, int workerId, CancellationToken cancellationToken)
        {
            // Здесь реализуйте вашу логику обработки
            // Примеры различных типов операций:
            
            switch (request.Operation.ToLower())
            {
                case "calculate":
                    return await CalculateAsync(request.Data, workerId, cancellationToken);
                
                case "process_data":
                    return await ProcessDataAsync(request.Data, workerId, cancellationToken);
                
                case "heavy_computation":
                    return await HeavyComputationAsync(request.Data, workerId, cancellationToken);
                
                default:
                    return new { error = "Unknown operation", operation = request.Operation };
            }
        }

        private async Task<object> CalculateAsync(string data, int workerId, CancellationToken ct)
        {
            // Пример вычислений
            await Task.Delay(100, ct); // Имитация работы
            
            return new
            {
                result = data.Length * 100,
                message = $"Вычислено в потоке {workerId}",
                timestamp = DateTime.UtcNow
            };
        }

        private async Task<object> ProcessDataAsync(string data, int workerId, CancellationToken ct)
        {
            // Пример обработки данных с использованием всех ядер
            var tasks = Enumerable.Range(0, Environment.ProcessorCount)
                .Select(core => Task.Run(() =>
                {
                    // Привязываем подзадачу к конкретному ядру
                    if (RuntimeInformation.IsOSPlatform(OSPlatform.Windows))
                    {
                        SetThreadAffinity(core);
                    }
                    
                    // Обработка части данных
                    return ProcessChunk(data, core);
                }, ct));

            var results = await Task.WhenAll(tasks);
            
            return new
            {
                processed = results.Sum(),
                workerId,
                coresUsed = Environment.ProcessorCount
            };
        }

        private int ProcessChunk(string data, int coreId)
        {
            // Пример обработки части данных
            Thread.SpinWait(1000000); // Имитация нагрузки
            return data.Length / Environment.ProcessorCount;
        }

        private async Task<object> HeavyComputationAsync(string data, int workerId, CancellationToken ct)
        {
            // Используем Parallel.For для использования всех ядер
            var results = new List<double>();
            var syncLock = new object();
            
            Parallel.For(0, 100, new ParallelOptions
            {
                MaxDegreeOfParallelism = Environment.ProcessorCount,
                CancellationToken = ct
            }, i =>
            {
                // Тяжелые вычисления
                double result = Math.Sqrt(i) * Math.Pow(data.Length, 0.5);
                lock (syncLock)
                {
                    results.Add(result);
                }
            });

            return new
            {
                average = results.Average(),
                count = results.Count,
                computedBy = "Parallel.For",
                workerId
            };
        }

        private async Task StartHttpServerAsync()
        {
            _httpListener.Start();
            Console.WriteLine($"HTTP сервер запущен на {string.Join(", ", _prefixes)}");

            while (!_cts.IsCancellationRequested)
            {
                try
                {
                    var context = await _httpListener.GetContextAsync();
                    if (context.Request.IsWebSocketRequest)
                    {
                        await HandleWebSocketConnectionAsync(context);
                    }
                    else
                    {
                        context.Response.StatusCode = 400;
                        context.Response.Close();
                    }
                }
                catch (Exception ex)
                {
                    Console.WriteLine($"Ошибка HTTP сервера: {ex.Message}");
                }
            }
        }

        private async Task HandleWebSocketConnectionAsync(HttpListenerContext context)
        {
            WebSocket webSocket = null;
            
            try
            {
                var wsContext = await context.AcceptWebSocketAsync(null);
                webSocket = wsContext.WebSocket;
                
                Console.WriteLine($"Новое WebSocket соединение: {context.Request.RemoteEndPoint}");

                await HandleWebSocketMessagesAsync(webSocket);
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Ошибка WebSocket: {ex.Message}");
            }
            finally
            {
                webSocket?.Dispose();
            }
        }

        private async Task HandleWebSocketMessagesAsync(WebSocket webSocket)
        {
            var buffer = new byte[4096];
            
            while (webSocket.State == WebSocketState.Open)
            {
                var result = await webSocket.ReceiveAsync(new ArraySegment<byte>(buffer), _cts.Token);
                
                if (result.MessageType == WebSocketMessageType.Text)
                {
                    var message = Encoding.UTF8.GetString(buffer, 0, result.Count);
                    
                    // Создаем запрос для обработки
                    var request = new WebSocketRequest
                    {
                        WebSocket = webSocket,
                        RequestId = Guid.NewGuid().ToString(),
                        Payload = message,
                        CompletionSource = new TaskCompletionSource<string>()
                    };
                    
                    // Добавляем в очередь для обработки
                    _requestQueue.Add(request);
                    
                    Console.WriteLine($"Запрос {request.RequestId} добавлен в очередь");
                }
                else if (result.MessageType == WebSocketMessageType.Close)
                {
                    await webSocket.CloseAsync(WebSocketCloseStatus.NormalClosure, string.Empty, CancellationToken.None);
                }
            }
        }

        private async Task SendErrorAsync(WebSocket webSocket, string requestId, string error, CancellationToken ct)
        {
            var errorResponse = new
            {
                RequestId = requestId,
                Error = error,
                Timestamp = DateTime.UtcNow
            };
            
            var json = JsonSerializer.Serialize(errorResponse);
            var buffer = Encoding.UTF8.GetBytes(json);
            
            await webSocket.SendAsync(
                new ArraySegment<byte>(buffer),
                WebSocketMessageType.Text,
                true,
                ct
            );
        }

        private void UpdateCorePerformance(int coreId, TimeSpan processingTime)
        {
            lock (_performanceLock)
            {
                if (_corePerformance.TryGetValue(coreId, out var perf))
                {
                    perf.TotalProcessed++;
                    perf.TotalProcessingTime += processingTime;
                    perf.LastUpdate = DateTime.UtcNow;
                }
            }
        }

        public Dictionary<string, object> GetPerformanceMetrics()
        {
            lock (_performanceLock)
            {
                return new Dictionary<string, object>
                {
                    ["QueueLength"] = _requestQueue.Count,
                    ["ActiveWorkers"] = _workerTasks.Count(t => !t.IsCompleted),
                    ["Cores"] = _corePerformance.Values.Select(p => new
                    {
                        p.CoreId,
                        p.TotalProcessed,
                        AverageTime = p.TotalProcessed > 0 
                            ? p.TotalProcessingTime.TotalMilliseconds / p.TotalProcessed 
                            : 0,
                        p.LastUpdate
                    }).ToList(),
                    ["TotalProcessed"] = _corePerformance.Values.Sum(p => p.TotalProcessed)
                };
            }
        }

        [DllImport("kernel32.dll")]
        private static extern uint SetThreadAffinityMask(IntPtr hThread, UIntPtr dwThreadAffinityMask);

        [DllImport("kernel32.dll")]
        private static extern IntPtr GetCurrentThread();

        private void SetThreadAffinity(int coreId)
        {
            if (coreId >= 0 && coreId < Environment.ProcessorCount)
            {
                var mask = new UIntPtr((uint)(1 << coreId));
                SetThreadAffinityMask(GetCurrentThread(), mask);
            }
        }

        public async Task StopAsync()
        {
            _cts.Cancel();
            _requestQueue.CompleteAdding();
            
            await Task.WhenAll(_workerTasks);
            _httpListener.Stop();
            
            Console.WriteLine("Контроллер остановлен");
        }

        public void Dispose()
        {
            _cts?.Dispose();
            _requestQueue?.Dispose();
            _httpListener?.Close();
        }
    }

    public class JsRequest
    {
        public string Operation { get; set; }
        public string Data { get; set; }
        public Dictionary<string, object> Parameters { get; set; }
    }

    public class JsResponse
    {
        public string RequestId { get; set; }
        public object Result { get; set; }
        public int WorkerId { get; set; }
        public int CoreId { get; set; }
        public long ProcessingTime { get; set; }
    }
}
