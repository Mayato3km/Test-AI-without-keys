using System;
using System.Threading.Tasks;

namespace MultiCoreControllerDemo
{
    class Program
    {
        static async Task Main(string[] args)
        {
            Console.WriteLine("=== Многопоточный контроллер ===");
            
            // Создаем контроллер с настройками
            var controller = new MultiCoreRequestController(
                maxThreads: 8,
                "http://localhost:8080/",
                "http://127.0.0.1:8080/"
            );
            
            try
            {
                // Запускаем контроллер
                var controllerTask = controller.StartAsync();
                
                Console.WriteLine("Контроллер запущен. Нажмите Enter для остановки...");
                Console.ReadLine();
                
                // Показываем метрики
                var metrics = controller.GetPerformanceMetrics();
                Console.WriteLine("\n=== Метрики производительности ===");
                Console.WriteLine($"Запросов в очереди: {metrics["QueueLength"]}");
                Console.WriteLine($"Всего обработано: {metrics["TotalProcessed"]}");
                
                // Останавливаем контроллер
                await controller.StopAsync();
            }
            catch (Exception ex)
            {
                Console.WriteLine($"Ошибка: {ex.Message}");
            }
        }
    }
}