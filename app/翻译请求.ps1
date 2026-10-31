[Console]::OutputEncoding = [System.Text.Encoding]::UTF8
[Console]::InputEncoding = [System.Text.Encoding]::UTF8
[Net.ServicePointManager]::SecurityProtocol = [Net.SecurityProtocolType]::Tls12
$url = [Console]::In.ReadToEnd()
try {
    $response = Invoke-WebRequest -Uri $url -TimeoutSec 15 -UseBasicParsing
    $response.RawContentStream.Position = 0
    $reader = New-Object System.IO.StreamReader($response.RawContentStream, [System.Text.Encoding]::UTF8)
    [Console]::Out.Write($reader.ReadToEnd())
} catch {
    [Console]::Error.Write($_.Exception.Message)
    exit 1
}
