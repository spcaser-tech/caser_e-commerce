param(
    [string]$Database = "gamers_oasis",
    [string]$Username = "postgres"
)

$securePassword = Read-Host "PostgreSQL password" -AsSecureString
$passwordPointer = [Runtime.InteropServices.Marshal]::SecureStringToBSTR($securePassword)
try {
    $password = [Runtime.InteropServices.Marshal]::PtrToStringBSTR($passwordPointer)
    $encodedPassword = [Uri]::EscapeDataString($password)
    $env:DATABASE_URL = "postgresql://$Username`:$encodedPassword@localhost:5432/$Database"
    python migrate_to_postgres.py
    if ($LASTEXITCODE -ne 0) {
        exit $LASTEXITCODE
    }
    python server.py
} finally {
    [Runtime.InteropServices.Marshal]::ZeroFreeBSTR($passwordPointer)
    Remove-Item Env:DATABASE_URL -ErrorAction SilentlyContinue
}
