use std::{fs, io, path::Path};

#[derive(Debug, PartialEq)]
pub struct Line {
    pub at_ms: u64,
    pub text: String,
}

pub fn read(path: &Path) -> io::Result<Vec<Line>> {
    let text = fs::read_to_string(path)?;
    let lines = parse(&text);
    if lines.is_empty() {
        return Err(io::Error::new(
            io::ErrorKind::InvalidData,
            "No timed LRC lines",
        ));
    }
    Ok(lines)
}

fn timestamp(value: &str) -> Option<u64> {
    let (minutes, rest) = value.split_once(':')?;
    let (seconds, fraction) = rest.split_once(['.', ':']).unwrap_or((rest, ""));
    let minutes: u64 = minutes.parse().ok()?;
    let seconds: u64 = seconds.parse().ok()?;
    if seconds >= 60 || fraction.len() > 3 {
        return None;
    }
    let millis = if fraction.is_empty() {
        0
    } else {
        fraction.parse::<u64>().ok()? * 10u64.pow(3 - fraction.len() as u32)
    };
    minutes
        .checked_mul(60_000)?
        .checked_add(seconds * 1000 + millis)
}

fn parse(text: &str) -> Vec<Line> {
    let mut offset = 0i64;
    let mut lines = Vec::new();
    for line in text.trim_start_matches('\u{feff}').lines().map(str::trim) {
        let mut content = line;
        let mut times = Vec::new();
        while let Some((tag, remainder)) = content
            .strip_prefix('[')
            .and_then(|value| value.split_once(']'))
        {
            if let Some(time) = timestamp(tag) {
                times.push(time);
                content = remainder;
            } else {
                if let Some(value) = tag
                    .strip_prefix("offset:")
                    .and_then(|v| v.trim().parse().ok())
                {
                    offset = value;
                }
                break;
            }
        }
        lines.extend(times.into_iter().map(|at_ms| Line {
            at_ms,
            text: content.trim().to_owned(),
        }));
    }
    for line in &mut lines {
        line.at_ms = line.at_ms.saturating_add_signed(offset);
    }
    lines.sort_by_key(|line| line.at_ms);
    lines
}

pub fn active_line(lines: &[Line], at_ms: u64) -> Option<usize> {
    lines
        .partition_point(|line| line.at_ms <= at_ms)
        .checked_sub(1)
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn sorts_and_offsets_repeated_tags() {
        let lines = parse(
            "\u{feff}[ar:Artist]\r\n[00:03.10][00:01:205]故乡\n[00:02]\n[00:61]ignore\n[offset:-200]",
        );
        assert_eq!(
            lines.iter().map(|line| line.at_ms).collect::<Vec<_>>(),
            [1005, 1800, 2900]
        );
        assert_eq!(lines[0].text, "故乡");
        assert_eq!(lines[1].text, "");
        assert_eq!(lines[2].text, "故乡");
        assert_eq!(active_line(&lines, 1004), None);
        assert_eq!(active_line(&lines, 1005), Some(0));
        assert_eq!(active_line(&lines, 2901), Some(2));
        assert_eq!(active_line(&lines, 1850), Some(1));
    }
}
