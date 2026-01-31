import json

def text_to_json_table(text, delimiter='\t'):
    lines = text.strip().split('\n')
    
    if not lines:
        return json.dumps([], indent=2)
    
    headers = [h.strip() for h in lines[0].split(delimiter)]
    
    data = []
    for line in lines[1:]:
        if line.strip():
            values = [v.strip() for v in line.split(delimiter)]
            row = {}
            for i, header in enumerate(headers):
                if i < len(values):
                    row[header] = values[i]
                else:
                    row[header] = None
            data.append(row)
    
    return json.dumps(data, indent=2, ensure_ascii=False)

sample_text = """Имя\tВозраст\tГород
Иван\t25\tМосква
Анна\t30\tСанкт-Петербург
Петр\t35\tКазань"""

json_output = text_to_json_table(sample_text, delimiter='\t')
print(json_output)

with open('table.json', 'w', encoding='utf-8') as f:
    f.write(json_output)



тут уже под js файл
_____________________________________________________________________________
function textToJsonTable(text, delimiter = '\t') {
    const lines = text.trim().split('\n');
    
    if (lines.length === 0) {
        return JSON.stringify([], null, 2);
    }
    
    const headers = lines[0].split(delimiter).map(h => h.trim());
    const data = [];
    
    for (let i = 1; i < lines.length; i++) {
        if (lines[i].trim()) {
            const values = lines[i].split(delimiter).map(v => v.trim());
            const row = {};
            
            headers.forEach((header, index) => {
                row[header] = values[index] !== undefined ? values[index] : null;
            });
            
            data.push(row);
        }
    }
    
    return JSON.stringify(data, null, 2);
}

const sampleText = `Имя\tВозраст\tГород
Иван\t25\tМосква
Анна\t30\tСанкт-Петербург
Петр\t35\tКазань`;

const jsonOutput = textToJsonTable(sampleText, '\t');
console.log(jsonOutput);

const fs = require('fs');
fs.writeFileSync('table.json', jsonOutput, 'utf-8');
_____________________________________________________________________________
