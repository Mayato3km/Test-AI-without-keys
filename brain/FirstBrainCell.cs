using System;
using System.Collections.Concurrent;
using System.Collections.Generic;
using System.Linq;
using System.Threading.Tasks;
using Jint;

public class TextGenerator : IDisposable
{
    private readonly ConcurrentDictionary<string, List<string>> _contextData;
    
    public TextGenerator()
    {
        _contextData = new ConcurrentDictionary<string, List<string>>();
    }
    
    public void AddContextData(string category, IEnumerable<string> entries)
    {
        _contextData.AddOrUpdate(
            category,
            new List<string>(entries),
            (key, existingList) =>
            {
                existingList.AddRange(entries);
                return existingList;
            });
    }
    
    public async Task<Dictionary<string, string>> ProcessQueriesInParallel(
        List<TextGenerationRequest> requests)
    {
        var tasks = requests.Select(request => 
            Task.Run(async () =>
            {
                try
                {
                    var result = await GenerateTextAsync(request);
                    return new { RequestId = request.Id, Result = result };
                }
                catch (Exception ex)
                {
                    return new { RequestId = request.Id, Result = $"Ошибка: {ex.Message}" };
                }
            }));
        
        var results = await Task.WhenAll(tasks);
        
        return results.ToDictionary(
            r => r.RequestId,
            r => r.Result);
    }
    
    public async Task<string> GenerateTextAsync(TextGenerationRequest request)
    {
        return await Task.Run(() =>
        {
            var contextData = _contextData.TryGetValue(request.Category, out var data) 
                ? data 
                : new List<string>();
            
            var engine = new Engine();
            
            engine.SetValue("contextData", contextData.ToArray());
            engine.SetValue("query", request.Query);
            
            string jsCode = @"
                function findSimilarEntries(data, q) {
                    return data.filter(function(entry) {
                        return entry.toLowerCase().indexOf(q.toLowerCase()) !== -1 ||
                               q.toLowerCase().indexOf(entry.toLowerCase()) !== -1;
                    }).slice(0, 3);
                }
                
                function generateTextBasedOnContext(contextData, query) {
                    const similarEntries = findSimilarEntries(contextData, query);
                    if (similarEntries.length === 0) {
                        return 'На основе запроса ""' + query + '"" сгенерирован текст: ...';
                    }
                    
                    return 'На основе ' + similarEntries.length + ' похожих записей: ' + 
                           similarEntries.join(' ') + 
                           ' В контексте: ' + query;
                }
                
                generateTextBasedOnContext(contextData, query);
            ";
            
            try
            {
                var result = engine.Evaluate(jsCode);
                return result?.ToString() ?? "Не удалось сгенерировать текст";
            }
            catch
            {
                return GenerateTextFallback(contextData, request.Query);
            }
        });
    }
    
    private string GenerateTextFallback(List<string> contextData, string query)
    {
        var similarEntries = contextData
            .Where(entry => entry.IndexOf(query, StringComparison.OrdinalIgnoreCase) >= 0 ||
                           query.IndexOf(entry, StringComparison.OrdinalIgnoreCase) >= 0)
            .Take(3)
            .ToList();
        
        if (similarEntries.Count == 0)
        {
            return $"На основе запроса '{query}' сгенерирован текст.";
        }
        
        return $"На основе {similarEntries.Count} похожих записей: " +
               string.Join(" ", similarEntries) +
               $" В контексте: {query}";
    }
    
    public async Task<List<string>> GenerateMultipleTextsAsync(List<TextGenerationRequest> requests, int maxConcurrency = 5)
    {
        var semaphore = new System.Threading.SemaphoreSlim(maxConcurrency);
        var tasks = new List<Task<string>>();
        
        foreach (var request in requests)
        {
            await semaphore.WaitAsync();
            
            tasks.Add(Task.Run(async () =>
            {
                try
                {
                    return await GenerateTextAsync(request);
                }
                finally
                {
                    semaphore.Release();
                }
            }));
        }
        
        return (await Task.WhenAll(tasks)).ToList();
    }
    
    public void Dispose()
    {
    }
}

public class TextGenerationRequest
{
    public string Id { get; set; } = Guid.NewGuid().ToString();
    public string Query { get; set; }
    public string Category { get; set; }
    public Dictionary<string, object> Parameters { get; set; } = new Dictionary<string, object>();
}