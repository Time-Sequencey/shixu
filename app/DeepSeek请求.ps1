[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
try {
    $inputData = [Console]::In.ReadToEnd() | ConvertFrom-Json
    $headers = @{
        Authorization = 'Bearer ' + $inputData.key
        Accept = 'application/json'
    }
    if ($inputData.action -eq 'balance') {
        $response = Invoke-WebRequest -Uri 'https://api.deepseek.com/user/balance' -Method Get -Headers $headers -TimeoutSec 30 -UseBasicParsing
    } else {
        $body = $inputData.payload | ConvertTo-Json -Depth 20 -Compress
        $response = Invoke-WebRequest -Uri 'https://api.deepseek.com/chat/completions' -Method Post -Headers $headers -ContentType 'application/json; charset=utf-8' -Body ([Text.Encoding]::UTF8.GetBytes($body)) -TimeoutSec 60 -UseBasicParsing
    }
    $response.RawContentStream.Position = 0
    $reader = New-Object System.IO.StreamReader($response.RawContentStream, [System.Text.Encoding]::UTF8)
    [Console]::Out.Write($reader.ReadToEnd())
} catch {
    $message = $_.Exception.Message
    if ($_.Exception.Response) {
        $message = 'DeepSeek HTTP ' + [int]$_.Exception.Response.StatusCode
    }
    [Console]::Error.Write($message)
    exit 1
}
