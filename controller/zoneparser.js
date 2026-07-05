/**
 * BIND DNS Zone File Parser
 * Parses raw zone text into a structured JSON array of records.
 */

export function parseZoneFile(zoneText, originDomain) {
  if (!originDomain.endsWith('.')) {
    originDomain = originDomain + '.';
  }

  let defaultTTL = 3600;
  let currentOrigin = originDomain;
  let lastOwner = '@';

  // Step 1: Preprocess lines - remove comments, combine multi-line parentheses
  const lines = zoneText.split(/\r?\n/);
  const processedLines = [];
  let parenBuffer = '';
  let inParen = false;

  for (let line of lines) {
    // Basic comment stripping (ignoring comments in quotes for simplicity, 
    // but typically zone files don't have semicolon inside quotes much, or we handle it simply)
    let cleanLine = '';
    let inQuote = false;
    for (let i = 0; i < line.length; i++) {
      const char = line[i];
      if (char === '"') inQuote = !inQuote;
      if (char === ';' && !inQuote) {
        break; // comment starts
      }
      cleanLine += char;
    }
    
    cleanLine = cleanLine.trim();
    if (!cleanLine) continue;

    if (inParen) {
      if (cleanLine.includes(')')) {
        inParen = false;
        parenBuffer += ' ' + cleanLine.substring(0, cleanLine.indexOf(')'));
        processedLines.push(parenBuffer.trim());
        parenBuffer = '';
      } else {
        parenBuffer += ' ' + cleanLine;
      }
    } else {
      if (cleanLine.includes('(')) {
        inParen = true;
        parenBuffer = cleanLine.substring(0, cleanLine.indexOf('('));
        if (cleanLine.includes(')')) { // all on one line
          inParen = false;
          parenBuffer += ' ' + cleanLine.substring(cleanLine.indexOf('(') + 1, cleanLine.indexOf(')'));
          processedLines.push(parenBuffer.trim());
          parenBuffer = '';
        }
      } else {
        processedLines.push(cleanLine);
      }
    }
  }

  const records = [];

  for (let line of processedLines) {
    // Parse directives: $TTL and $ORIGIN
    if (line.startsWith('$TTL')) {
      const parts = line.split(/\s+/);
      if (parts.length > 1) {
        defaultTTL = parseTTL(parts[1]);
      }
      continue;
    }
    if (line.startsWith('$ORIGIN')) {
      const parts = line.split(/\s+/);
      if (parts.length > 1) {
        currentOrigin = parts[1];
        if (!currentOrigin.endsWith('.')) currentOrigin += '.';
      }
      continue;
    }

    // Replace tabs with spaces and tokenize
    const tokens = tokenizeZoneLine(line);
    if (tokens.length < 2) continue;

    let owner = tokens[0];
    let tokenIndex = 1;

    // Check if the first token is a record type or TTL or class. 
    // If it is, then the owner is the lastOwner (inherited owner).
    const classes = ['IN', 'CS', 'CH', 'HS'];
    const types = ['A', 'AAAA', 'CNAME', 'MX', 'TXT', 'NS', 'SRV', 'CAA', 'SOA', 'PTR'];
    
    let isOwnerInherited = false;
    if (tokens[0] === 'IN' || types.includes(tokens[0]) || /^\d+[smhdw]?$/i.test(tokens[0])) {
      owner = lastOwner;
      tokenIndex = 0;
      isOwnerInherited = true;
    } else {
      lastOwner = owner;
    }

    // Extract TTL and Class if present
    let ttl = defaultTTL;
    let rrClass = 'IN';

    while (tokenIndex < tokens.length) {
      const token = tokens[tokenIndex];
      if (/^\d+[smhdw]?$/i.test(token)) {
        ttl = parseTTL(token);
        tokenIndex++;
      } else if (classes.includes(token.toUpperCase())) {
        rrClass = token.toUpperCase();
        tokenIndex++;
      } else {
        break;
      }
    }

    if (tokenIndex >= tokens.length) continue;

    // Record Type
    const type = tokens[tokenIndex].toUpperCase();
    tokenIndex++;

    if (!types.includes(type)) {
      // Skip unrecognized record types
      continue;
    }

    // Remaining tokens form the content (RDATA)
    const contentTokens = tokens.slice(tokenIndex);
    if (contentTokens.length === 0) continue;

    let content = '';
    let priority = 0;

    // Expand shorthand owner names
    let normalizedName = owner;
    if (normalizedName === '@') {
      normalizedName = currentOrigin;
    } else if (!normalizedName.endsWith('.')) {
      normalizedName = normalizedName + '.' + currentOrigin;
    }
    // Strip trailing dot for DB storage convenience
    normalizedName = stripTrailingDot(normalizedName);

    if (type === 'MX') {
      priority = parseInt(contentTokens[0], 10) || 0;
      let target = contentTokens.slice(1).join(' ');
      if (!target.endsWith('.')) target = target + '.' + currentOrigin;
      content = stripTrailingDot(target);
    } else if (type === 'SRV') {
      // SRV format: priority weight port target
      priority = parseInt(contentTokens[0], 10) || 0;
      const weight = parseInt(contentTokens[1], 10) || 0;
      const port = parseInt(contentTokens[2], 10) || 0;
      let target = contentTokens.slice(3).join(' ');
      if (!target.endsWith('.')) target = target + '.' + currentOrigin;
      target = stripTrailingDot(target);
      content = `${weight} ${port} ${target}`;
    } else if (type === 'CNAME' || type === 'NS' || type === 'PTR') {
      let target = contentTokens.join(' ');
      if (!target.endsWith('.')) target = target + '.' + currentOrigin;
      content = stripTrailingDot(target);
    } else if (type === 'TXT') {
      // Join TXT tokens (handling quotes)
      content = contentTokens.join(' ');
      if (content.startsWith('"') && content.endsWith('"')) {
        content = content.substring(1, content.length - 1);
      }
    } else if (type === 'SOA') {
      // SOA format: mname rname serial refresh retry expire minimum
      content = contentTokens.join(' ');
    } else {
      content = contentTokens.join(' ');
    }

    records.push({
      name: normalizedName,
      type,
      content,
      ttl,
      priority
    });
  }

  return records;
}

// Convert TTL string (like 1h, 1d) to seconds
function parseTTL(ttlStr) {
  const match = ttlStr.match(/^(\d+)([smhdw]?)$/i);
  if (!match) return 3600;
  const val = parseInt(match[1], 10);
  const unit = (match[2] || 's').toLowerCase();
  switch (unit) {
    case 'w': return val * 7 * 24 * 3600;
    case 'd': return val * 24 * 3600;
    case 'h': return val * 3600;
    case 'm': return val * 60;
    case 's':
    default: return val;
  }
}

function stripTrailingDot(str) {
  if (str.endsWith('.')) {
    return str.substring(0, str.length - 1);
  }
  return str;
}

// Helper to tokenize a zone line, respecting quotes
function tokenizeZoneLine(line) {
  const tokens = [];
  let currentToken = '';
  let inQuotes = false;
  
  for (let i = 0; i < line.length; i++) {
    const char = line[i];
    if (char === '"') {
      inQuotes = !inQuotes;
      currentToken += char;
    } else if (/\s/.test(char) && !inQuotes) {
      if (currentToken) {
        tokens.push(currentToken);
        currentToken = '';
      }
    } else {
      currentToken += char;
    }
  }
  if (currentToken) {
    tokens.push(currentToken);
  }
  return tokens;
}

export function generateZoneFile(domain, records, serial, defaultTtl = 3600) {
  const origin = `${domain}.`;
  let fileText = `$ORIGIN ${origin}\n`;
  fileText += `$TTL ${defaultTtl}\n\n`;

  // Find or generate SOA
  const soa = records.find(r => r.type === 'SOA');
  if (soa) {
    // Replace serial inside the content or format it
    // SOA content is usually: mname rname ( serial refresh retry expire minimum )
    // or just: ns1.domain.com. admin.domain.com. serial refresh retry expire minimum
    const parts = soa.content.split(/\s+/);
    if (parts.length >= 7) {
      // Find where serial is (typically parts[2] if no parenthesis, or if we strip parenthesis)
      // For simplicity, write a clean standard SOA template
      const mname = parts[0].endsWith('.') ? parts[0] : parts[0] + '.';
      const rname = parts[1].endsWith('.') ? parts[1] : parts[1] + '.';
      const refresh = parts[3] || '86400';
      const retry = parts[4] || '7200';
      const expire = parts[5] || '3600000';
      const minimum = parts[6] || '86400';
      
      fileText += `@ IN SOA ${mname} ${rname} (\n`;
      fileText += `  ${serial} ; serial\n`;
      fileText += `  ${refresh} ; refresh\n`;
      fileText += `  ${retry} ; retry\n`;
      fileText += `  ${expire} ; expire\n`;
      fileText += `  ${minimum} ; minimum\n`;
      fileText += `)\n\n`;
    } else {
      fileText += `@ IN SOA ns1.${origin} admin.${origin} (\n`;
      fileText += `  ${serial} ; serial\n`;
      fileText += `  86400 ; refresh\n`;
      fileText += `  7200 ; retry\n`;
      fileText += `  3600000 ; expire\n`;
      fileText += `  86400 ; minimum\n`;
      fileText += `)\n\n`;
    }
  } else {
    // Default SOA if none found
    fileText += `@ IN SOA ns1.${origin} admin.${origin} (\n`;
    fileText += `  ${serial} ; serial\n`;
    fileText += `  86400 ; refresh\n`;
    fileText += `  7200 ; retry\n`;
    fileText += `  3600000 ; expire\n`;
    fileText += `  86400 ; minimum\n`;
    fileText += `)\n\n`;
  }

  // Add NS records first
  const nsRecords = records.filter(r => r.type === 'NS');
  for (let r of nsRecords) {
    const owner = formatOwner(r.name, domain);
    const target = r.content.endsWith('.') ? r.content : r.content + '.';
    fileText += `${owner} ${r.ttl || defaultTtl} IN NS ${target}\n`;
  }
  if (nsRecords.length > 0) fileText += '\n';

  // Add other records
  const otherRecords = records.filter(r => r.type !== 'SOA' && r.type !== 'NS');
  for (let r of otherRecords) {
    const owner = formatOwner(r.name, domain);
    let rdata = r.content;

    if (r.type === 'MX') {
      const target = r.content.endsWith('.') ? r.content : r.content + '.';
      rdata = `${r.priority || 0} ${target}`;
    } else if (r.type === 'SRV') {
      // content has: weight port target
      const parts = r.content.split(/\s+/);
      const weight = parts[0] || '0';
      const port = parts[1] || '0';
      let target = parts.slice(2).join(' ');
      if (target && !target.endsWith('.')) target += '.';
      rdata = `${r.priority || 0} ${weight} ${port} ${target}`;
    } else if (r.type === 'CNAME' || r.type === 'PTR') {
      if (!rdata.endsWith('.')) rdata += '.';
    } else if (r.type === 'TXT') {
      rdata = `"${r.content.replace(/"/g, '\\"')}"`;
    }

    fileText += `${owner} ${r.ttl || defaultTtl} IN ${r.type} ${rdata}\n`;
  }

  return fileText;
}

function formatOwner(name, domain) {
  if (name === domain) return '@';
  if (name.endsWith('.' + domain)) {
    return name.substring(0, name.length - domain.length - 1);
  }
  // If it doesn't match the domain, return it absolute with trailing dot
  return name.endsWith('.') ? name : name + '.';
}
