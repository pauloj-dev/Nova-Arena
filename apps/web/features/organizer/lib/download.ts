/** Entrega um arquivo para o navegador salvar (CSV exportado, modelo de CSV). */
export function downloadFile(content: Blob | string, filename: string, type = 'application/octet-stream'): void {
  const blob = typeof content === 'string' ? new Blob([content], { type }) : content;
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // O navegador precisa de um instante para começar o download antes de o endereço temporário sumir.
  setTimeout(() => URL.revokeObjectURL(url), 1000);
}
