class ConvertError(Exception):
    """Error yang pesannya aman & berguna ditampilkan ke user (bahasa biasa)."""

    def __init__(self, message: str, status: int = 400):
        super().__init__(message)
        self.message = message
        self.status = status
