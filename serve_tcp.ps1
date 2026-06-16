$port = 8000
$listener = New-Object System.Net.Sockets.TcpListener([System.Net.IPAddress]::Any, $port)
$listener.Start()
Write-Host "TCP Web Server started on port $port..."

try {
    while ($true) {
        if ($listener.Pending()) {
            try {
                $client = $listener.AcceptTcpClient()
                Write-Host "Connection accepted from $($client.Client.RemoteEndPoint)"
                $stream = $client.GetStream()
                
                # Wait for data to be available (up to 1 second)
                $waitCount = 0
                while (-not $stream.DataAvailable -and $waitCount -lt 10) {
                    Start-Sleep -Milliseconds 100
                    $waitCount++
                }
                
                if ($stream.DataAvailable) {
                    $buffer = New-Object byte[] 4096
                    $readBytes = $stream.Read($buffer, 0, $buffer.Length)
                    Write-Host "Read $readBytes bytes from client"
                    
                    if ($readBytes -gt 0) {
                        $requestStr = [System.Text.Encoding]::ASCII.GetString($buffer, 0, $readBytes)
                        
                        if ($requestStr -match "GET ([^ ]+) HTTP") {
                            $urlPath = $Matches[1]
                            if ($urlPath -eq "/") { $urlPath = "/index.html" }
                            $urlPath = $urlPath.Split('?')[0]
                            
                            $relative = $urlPath.TrimStart('/')
                            $baseDir = $PSScriptRoot
                            $filePath = Join-Path $baseDir $relative.Replace("/", "\")
                            
                            Write-Host "Requested path: $urlPath -> Resolved file: $filePath"
                            
                            if (Test-Path -Path $filePath -PathType Leaf) {
                                $bytes = [System.IO.File]::ReadAllBytes($filePath)
                                Write-Host "Serving file ($($bytes.Length) bytes)"
                                
                                $ext = [System.IO.Path]::GetExtension($filePath).ToLower()
                                $contentType = "application/octet-stream"
                                if ($ext -eq ".html") { $contentType = "text/html; charset=utf-8" }
                                elseif ($ext -eq ".css") { $contentType = "text/css; charset=utf-8" }
                                elseif ($ext -eq ".js") { $contentType = "application/javascript; charset=utf-8" }
                                elseif ($ext -eq ".mp3") { $contentType = "audio/mpeg" }
                                elseif ($ext -eq ".png") { $contentType = "image/png" }
                                elseif ($ext -eq ".jpg" -or $ext -eq ".jpeg") { $contentType = "image/jpeg" }
                                
                                $headers = "HTTP/1.1 200 OK`r`nContent-Type: $contentType`r`nContent-Length: $($bytes.Length)`r`nConnection: close`r`nAccess-Control-Allow-Origin: *`r`n`r`n"
                                $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
                                
                                $stream.Write($headerBytes, 0, $headerBytes.Length)
                                $stream.Write($bytes, 0, $bytes.Length)
                            } else {
                                Write-Host "File not found: $filePath"
                                $err = "File Not Found: $urlPath"
                                $errBytes = [System.Text.Encoding]::UTF8.GetBytes($err)
                                $headers = "HTTP/1.1 404 Not Found`r`nContent-Type: text/plain; charset=utf-8`r`nContent-Length: $($errBytes.Length)`r`nConnection: close`r`nAccess-Control-Allow-Origin: *`r`n`r`n"
                                $headerBytes = [System.Text.Encoding]::ASCII.GetBytes($headers)
                                
                                $stream.Write($headerBytes, 0, $headerBytes.Length)
                                $stream.Write($errBytes, 0, $errBytes.Length)
                            }
                        }
                    }
                } else {
                    Write-Host "No data received within timeout"
                }
                $stream.Close()
                $client.Close()
                Write-Host "Connection closed"
            } catch {
                Write-Host "Request error: $_"
                if ($null -ne $stream) { try { $stream.Close() } catch {} }
                if ($null -ne $client) { try { $client.Close() } catch {} }
            }
        } else {
            Start-Sleep -Milliseconds 100
        }
    }
} catch {
    Write-Host "Server error: $_"
} finally {
    $listener.Stop()
    Write-Host "Server stopped."
}
