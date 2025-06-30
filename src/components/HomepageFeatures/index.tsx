import type {ReactNode} from 'react';
import clsx from 'clsx';
import Heading from '@theme/Heading';
import styles from './styles.module.css';

type FeatureItem = {
  title: string;
  Svg?: React.ComponentType<React.ComponentProps<'svg'>>;
  imageUrl?: string;
  description: ReactNode;
};

const FeatureList: FeatureItem[] = [
  {
    title: 'A work of love',
    Svg: require('@site/static/img/agape_loog.svg').default,
    description: (
      <>
        The Agape project is a labor of love, dedicated to sharing the art and ethos
      </>
    ),
  },
  {
    title: 'Started by one',
    imageUrl: require('@site/static/img/ctzurcanu.png').default,
    description: (
      <>
        Started by one person
      </>
    ),
  },
  {
    title: 'Welcoming contributions',
    Svg: require('@site/static/img/welcome_loog.svg').default,
    description: (
      <>
        If you are an ethical creator, you are welcome to contribute to the project.
      </>
    ),
  },
];

function Feature({title, Svg, imageUrl, description}: FeatureItem) {
  return (
    <div className={clsx('col col--4')}>
      <div className="text--center">
        {Svg && <Svg className={styles.featureSvg} role="img" />}
        {imageUrl && <img className={styles.featureSvg} src={imageUrl} alt={title} />}
      </div>
      <div className="text--center padding-horiz--md">
        <Heading as="h3">{title}</Heading>
        <p>{description}</p>
      </div>
    </div>
  );
}

export default function HomepageFeatures(): ReactNode {
  return (
    <section className={styles.features}>
      <div className="container">
        <div className="row">
          {FeatureList.map((props, idx) => (
            <Feature key={idx} {...props} />
          ))}
        </div>
      </div>
    </section>
  );
}
