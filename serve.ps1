$port = 8000
$listener = New-Object System.Net.HttpListener
$listener.Prefixes.Add("http://localhost:$port/")
$listener.Prefixes.Add("http://127.0.0.1:$port/")
$listener.Start()
Write-Host "Server started on port $port..."

try {
    while ($listener.IsListening) {
        try {
            $context = $listener.GetContext()
            $request = $context.Request
            $response = $context.Response

            $urlPath = $request.Url.LocalPath
            if ($urlPath -eq "/") { $urlPath = "/index.html" }
            
            # Resolve full file path relative to scripts root
            $relative = $urlPath.TrimStart('/')
            $filePath = Join-Path $PSScriptRoot $relative.Replace("/", "\")
            
            if (Test-Path -Path $filePath -PathType Leaf) {
                $bytes = [System.IO.File]::ReadAllBytes($filePath)
                
                # Content type mapping
                $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                $contentType = "application/octet-stream"
                if ($ext -eq ".html") { $contentType = "text/html; charset=utf-8" }
                elseif ($ext -eq ".css") { $contentType = "text/css; charset=utf-8" }
                elseif ($ext -eq ".js") { $contentType = "application/javascript; charset=utf-8" }
                elseif ($ext -eq ".mp3") { $contentType = "audio/mpeg" }
                elseif ($ext -eq ".png") { $contentType = "image/png" }
                elseif ($ext -eq ".jpg" -or $ext -eq ".jpeg") { $contentType = "image/jpeg" }
                
                $response.ContentType = $contentType
                $response.ContentLength64 = $bytes.Length
                $response.OutputStream.Write($bytes, 0, $bytes.Length)
            } else {
                $response.StatusCode = 404
                $errBytes = [System.Text.Encoding]::UTF8.GetBytes("File Not Found: $filePath")
                $response.OutputStream.Write($errBytes, 0, $errBytes.Length)
            }
            $response.Close()
        } catch {
            Write-Host "Error processing request: $_"
            if ($null -ne $response) {
                try { $response.Close() } catch {}
            }
        }
    }
} catch {
    Write-Host "Server error: $_"
} finally {
    $listener.Stop()
    Write-Host "Server stopped."
}
