import ReactMarkdown from 'react-markdown'
import { safeLink } from './utils'

export function Markdown({ text }: { text: string }) {
  return (
    <ReactMarkdown
      skipHtml
      allowedElements={['p', 'a', 'strong', 'em', 'br']}
      unwrapDisallowed
      urlTransform={safeLink}
      components={{
        a: ({ href, children }) =>
          href ? (
            <a href={href} target="_blank" rel="noopener noreferrer">
              {children}
            </a>
          ) : (
            <span>{children}</span>
          ),
      }}
    >
      {text}
    </ReactMarkdown>
  )
}
