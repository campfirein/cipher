let normalized = "What is the difference between AI \n \n \n and ML?"
// normalized = normalized.replace(/[\n\r]/g, ' ');

normalized = normalized.replace(/[\n\r]/g, ' ').replace(/\s+/g, ' ').trim();
console.log(normalized)